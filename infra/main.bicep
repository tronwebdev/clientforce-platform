// Clientforce — app-deploy layer (T7).
//
// Deploys the workloads onto the EXISTING, team-provisioned platform
// (Postgres / Redis / Storage / Key Vault / ACR / Container Apps env are
// referenced, never mutated here). Every credential is pulled from Key Vault at
// runtime via secretRef + the user-assigned managed identity — there are NO
// secret values in this template, only secret NAMES.

@description('Azure region (e.g. westus).')
param location string = resourceGroup().location

@description('Existing Container Apps managed environment name.')
param containerAppsEnvName string

@description('Existing Key Vault name (RBAC authorization mode).')
param keyVaultName string

@description('Existing Azure Container Registry name.')
param acrName string

@description('ACR login server, e.g. clientforcedev.azurecr.io.')
param acrLoginServer string

@description('User-assigned managed identity to create for the workloads.')
param managedIdentityName string = 'id-clientforce-dev'

@description('Image tag to deploy (usually the git SHA).')
param imageTag string

@description('Whether Key Vault holds STORAGE-CONNECTION-STRING yet (P1.2 DOCUMENT uploads). The pipeline probes the vault and passes this; referencing a missing secret would fail the whole deploy, so it stays conditional until the owner adds it.')
param storageSecretAvailable bool = false

@description('Whether Key Vault holds the Temporal Cloud trio (TEMPORAL-ADDRESS/TEMPORAL-NAMESPACE/TEMPORAL-API-KEY, P1.6/OWNER_CHECKLIST §4). Probed by the pipeline like storage.')
param temporalSecretsAvailable bool = false

@description('Whether Key Vault holds INBOUND-PARSE-TOKEN (P1.7 inbound parse URL secret). Probed by the pipeline.')
param inboundTokenAvailable bool = false

@description('Whether Key Vault holds SENDGRID-WEBHOOK-PUBLIC-KEY (P1.7 signed event webhook). Probed by the pipeline.')
param sgWebhookKeyAvailable bool = false

@description('Whether Key Vault holds the Clerk quartet (CLERK-PUBLISHABLE-KEY/CLERK-SECRET-KEY for web, CLERK-JWKS-URL/CLERK-ISSUER for the api verifier — A3/DEC-060). Probed by the pipeline; absent = dev-token auth only.')
param clerkSecretsAvailable bool = false

@description('SendGrid sandbox mode (A3/DEC-060a). Stays "true" in every environment config by default; ONLY a production parameter file flips it to "false", and the live-send proof gates on domain auth first. Never flip by editing this default.')
param sendgridSandbox string = 'true'

@description('Whether Key Vault holds the Twilio pair (TWILIO-ACCOUNT-SID/TWILIO-AUTH-TOKEN — P2.1/DEC-061). Probed by the pipeline; absent = sms transport unconfigured (sends refuse typed, inbound rejected in production).')
param twilioSecretsAvailable bool = false

@description('Twilio SMS sandbox (P2.1/DEC-061, same discipline as SENDGRID_SANDBOX): \'true\' everywhere by default; only an explicit production parameter flips it.')
param smsSandbox string = 'true'

@description('DEC-063/067: whether Key Vault holds SMS-ALLOWLIST (comma-separated E.164 SMS recipients — phone numbers never live in this public repo). Probed by the pipeline; absent = no live SMS recipients anywhere.')
param smsAllowlistAvailable bool = false

@description('P3.1 (DEC-078): whether Key Vault holds VOICE-FROM-NUMBER (the platform Voice-capable sender). Absent = the dialer is unconfigured; dials refuse typed.')
param voiceFromAvailable bool = false

@description('P3.1 (DEC-078, DEC-063 analog): whether Key Vault holds VOICE-ALLOWLIST (comma-separated E.164 voice recipients — numbers never live in this repo). Absent = no live voice recipients anywhere.')
param voiceAllowlistAvailable bool = false

@description('P3.1 (DEC-078): voice dial sandbox (the SMS_SANDBOX twin): \'true\' everywhere by default; only an explicit production parameter flips it.')
param voiceSandbox string = 'true'

@description('P3.1 (DEC-078): explicit override for the voice service public https base. Normally EMPTY — when deployVoiceService is true the template derives it from the voice app\'s deterministic FQDN; set this only to point the api at a voice service living elsewhere.')
param voiceServiceUrl string = ''

@description('P3.1 deploy (DEC-090): ship the clientforce-voice container app. The pipeline passes true only when Key Vault holds BOTH DEEPGRAM-API-KEY (the service cannot run without it) AND the Twilio pair (the /twiml + /media access gate derives its token from TWILIO-AUTH-TOKEN — deploying ungated on a public FQDN is never acceptable).')
param deployVoiceService bool = false
@description('LH1 (DEC-087): whether Key Vault holds the ZeroBounce key. Probed by the pipeline; absent = email-validation batches hold with the typed provider refusal (contacts stay unverified + held at the enrollment gate — never silently enrolled).')
param zerobounceSecretAvailable bool = false

@description('LH1 (DEC-087): the Key Vault secret NAME holding the ZeroBounce key. Canonical: ZEROBOUNCE-API-KEY; the pipeline passes ASMITH-KEY-L1 when only the owner\'s original upload (2026-07-15) exists — normalize when convenient.')
param zerobounceSecretName string = 'ZEROBOUNCE-API-KEY'

@description('INT W1 (DEC-093): whether Key Vault holds the Slack app pair (SLACK-CLIENT-ID + SLACK-CLIENT-SECRET — the owner-created Slack app). Probed by the pipeline; absent = the Integrations page refuses Slack connect with the typed honest owner-clock state, never a broken redirect.')
param slackSecretAvailable bool = false

@description('INT W1 (DEC-093): the public web origin the api hands to OAuth vendors as the callback base (…/integrations/callback/<provider>). Empty = the api falls back to its localhost default, so OAuth connects stay refused until the pipeline passes the real staging web URL.')
param webAppUrl string = ''

@description('INT W2 (DEC-094): whether Key Vault holds the Google app pair (GOOGLE-CLIENT-ID + GOOGLE-CLIENT-SECRET — the owner-created Google Cloud OAuth client). Probed by the pipeline; absent = the Integrations page refuses Google Calendar connect with the typed honest owner-clock state, never a broken redirect.')
param googleSecretAvailable bool = false

@description('INT W2 (DEC-094): the API service\'s own public https base — the base VENDOR WEBHOOKS must reach (Calendly POSTs to <base>/webhooks/calendly?token=…; the webhook targets the API, never the web app, and deriving the base from request origins is unreliable behind ingress). Empty = the api falls back to PUBLIC_API_URL then localhost, so webhook subscriptions stay dev-only until the pipeline passes the real staging api URL (the webAppUrl pattern).')
param integrationsWebhookBase string = ''

param apiAppName string = 'clientforce-api'
param workerAppName string = 'clientforce-worker'
param webAppName string = 'clientforce-web'
param migrateJobName string = 'clientforce-migrate'
param voiceAppName string = 'clientforce-voice'

// ── Existing platform resources (referenced, not created) ───────────────────
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: acrName }
resource env 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: containerAppsEnvName }

// ── Managed identity + RBAC (KV Secrets User, AcrPull) ──────────────────────
resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: managedIdentityName
  location: location
}

var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6' // Key Vault Secrets User
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull

resource kvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, uami.id, kvSecretsUserRoleId)
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource acrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Shared config ───────────────────────────────────────────────────────────
var kvUri = kv.properties.vaultUri
var idConfig = { type: 'UserAssigned', userAssignedIdentities: { '${uami.id}': {} } }
var registries = [{ server: acrLoginServer, identity: uami.id }]

// Key Vault-backed Container Apps secrets (local name -> KV secret name).
var dbUrlSecret = { name: 'database-url', keyVaultUrl: '${kvUri}secrets/DATABASE-URL', identity: uami.id }
var appDbUrlSecret = { name: 'app-database-url', keyVaultUrl: '${kvUri}secrets/APP-DATABASE-URL', identity: uami.id }
var redisUrlSecret = { name: 'redis-url', keyVaultUrl: '${kvUri}secrets/REDIS-URL', identity: uami.id }
var authDevSecret = { name: 'auth-dev-secret', keyVaultUrl: '${kvUri}secrets/AUTH-DEV-SECRET', identity: uami.id }
var openaiKeySecret = { name: 'openai-api-key', keyVaultUrl: '${kvUri}secrets/OPENAI-API-KEY', identity: uami.id }
var anthropicKeySecret = { name: 'anthropic-api-key', keyVaultUrl: '${kvUri}secrets/ANTHROPIC-API-KEY', identity: uami.id }
var sendgridKeySecret = { name: 'sendgrid-api-key', keyVaultUrl: '${kvUri}secrets/SENDGRID-API-KEY', identity: uami.id }
var fieldEncKeySecret = { name: 'field-encryption-key', keyVaultUrl: '${kvUri}secrets/FIELD-ENCRYPTION-KEY', identity: uami.id }
var storageConnSecret = { name: 'storage-connection-string', keyVaultUrl: '${kvUri}secrets/STORAGE-CONNECTION-STRING', identity: uami.id }

// P1.2: api + worker both embed (retrieve/ingest) and both touch the uploads
// blob container; the storage secret + env appear only once the vault has it.
var storageSecrets = storageSecretAvailable ? [storageConnSecret] : []
var storageEnv = storageSecretAvailable ? [{ name: 'STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }] : []

// P1.6/P1.7: Temporal Cloud endpoint (worker runs CampaignWorkflows; api starts
// them) + the inbound-parse URL token (api verifies unsigned Inbound Parse
// posts). Conditional like storage so deploys never break while pending.
var temporalAddressSecret = { name: 'temporal-address', keyVaultUrl: '${kvUri}secrets/TEMPORAL-ADDRESS', identity: uami.id }
var temporalNamespaceSecret = { name: 'temporal-namespace', keyVaultUrl: '${kvUri}secrets/TEMPORAL-NAMESPACE', identity: uami.id }
var temporalApiKeySecret = { name: 'temporal-api-key', keyVaultUrl: '${kvUri}secrets/TEMPORAL-API-KEY', identity: uami.id }
var temporalSecrets = temporalSecretsAvailable ? [temporalAddressSecret, temporalNamespaceSecret, temporalApiKeySecret] : []
var temporalEnv = temporalSecretsAvailable ? [
  { name: 'TEMPORAL_ADDRESS', secretRef: 'temporal-address' }
  { name: 'TEMPORAL_NAMESPACE', secretRef: 'temporal-namespace' }
  { name: 'TEMPORAL_API_KEY', secretRef: 'temporal-api-key' }
] : []
var inboundTokenSecret = { name: 'inbound-parse-token', keyVaultUrl: '${kvUri}secrets/INBOUND-PARSE-TOKEN', identity: uami.id }
var inboundTokenSecrets = inboundTokenAvailable ? [inboundTokenSecret] : []
var inboundTokenEnv = inboundTokenAvailable ? [{ name: 'INBOUND_PARSE_TOKEN', secretRef: 'inbound-parse-token' }] : []
// P1.7 owner step (2026-07-05): the signed event webhook's verification key.
var sgWebhookKeySecret = { name: 'sendgrid-webhook-public-key', keyVaultUrl: '${kvUri}secrets/SENDGRID-WEBHOOK-PUBLIC-KEY', identity: uami.id }
var sgWebhookKeySecrets = sgWebhookKeyAvailable ? [sgWebhookKeySecret] : []
var sgWebhookKeyEnv = sgWebhookKeyAvailable ? [{ name: 'SENDGRID_WEBHOOK_PUBLIC_KEY', secretRef: 'sendgrid-webhook-public-key' }] : []
// A3 (DEC-060): Clerk — api verifies via JWKS (no vendor SDK); web gets the
// publishable + secret keys. All four ride Key Vault so the public repo never
// names the Clerk instance.
var clerkJwksSecret = { name: 'clerk-jwks-url', keyVaultUrl: '${kvUri}secrets/CLERK-JWKS-URL', identity: uami.id }
var clerkIssuerSecret = { name: 'clerk-issuer', keyVaultUrl: '${kvUri}secrets/CLERK-ISSUER', identity: uami.id }
var clerkPublishableSecret = { name: 'clerk-publishable-key', keyVaultUrl: '${kvUri}secrets/CLERK-PUBLISHABLE-KEY', identity: uami.id }
var clerkSecretKeySecret = { name: 'clerk-secret-key', keyVaultUrl: '${kvUri}secrets/CLERK-SECRET-KEY', identity: uami.id }
var clerkApiSecrets = clerkSecretsAvailable ? [clerkJwksSecret, clerkIssuerSecret] : []
var clerkApiEnv = clerkSecretsAvailable ? [
  { name: 'AUTH_JWKS_URL', secretRef: 'clerk-jwks-url' }
  { name: 'AUTH_ISSUER', secretRef: 'clerk-issuer' }
] : []
var clerkWebSecrets = clerkSecretsAvailable ? [clerkPublishableSecret, clerkSecretKeySecret] : []
var clerkWebEnv = clerkSecretsAvailable ? [
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', secretRef: 'clerk-publishable-key' }
  { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
] : []
// P2.1 (DEC-061): Twilio credentials — same conditional pattern.
var twilioSidSecret = { name: 'twilio-account-sid', keyVaultUrl: '${kvUri}secrets/TWILIO-ACCOUNT-SID', identity: uami.id }
var twilioTokenSecret = { name: 'twilio-auth-token', keyVaultUrl: '${kvUri}secrets/TWILIO-AUTH-TOKEN', identity: uami.id }
var twilioSecrets = twilioSecretsAvailable ? [twilioSidSecret, twilioTokenSecret] : []
var twilioEnv = twilioSecretsAvailable ? [
  { name: 'TWILIO_ACCOUNT_SID', secretRef: 'twilio-account-sid' }
  { name: 'TWILIO_AUTH_TOKEN', secretRef: 'twilio-auth-token' }
] : []
// DEC-067: the allow-list rides Key Vault (numbers never live in the repo).
var smsAllowlistSecret = { name: 'sms-allowlist', keyVaultUrl: '${kvUri}secrets/SMS-ALLOWLIST', identity: uami.id }
var smsAllowlistSecrets = smsAllowlistAvailable ? [smsAllowlistSecret] : []
// LH1 (DEC-087): ZeroBounce — validation runs in the WORKER only (the api
// enqueues batches; it never talks to the provider).
var zerobounceSecret = { name: 'zerobounce-api-key', keyVaultUrl: '${kvUri}secrets/${zerobounceSecretName}', identity: uami.id }
var zerobounceSecrets = zerobounceSecretAvailable ? [zerobounceSecret] : []
var zerobounceEnv = zerobounceSecretAvailable ? [
  { name: 'ZEROBOUNCE_API_KEY', secretRef: 'zerobounce-api-key' }
] : []
// INT W1 (DEC-093): the Slack app pair — the API only (OAuth start/exchange);
// the worker posts with per-workspace tokens field-encrypted in the DB and
// never needs the app credentials.
var slackClientIdSecret = { name: 'slack-client-id', keyVaultUrl: '${kvUri}secrets/SLACK-CLIENT-ID', identity: uami.id }
var slackClientSecretSecret = { name: 'slack-client-secret', keyVaultUrl: '${kvUri}secrets/SLACK-CLIENT-SECRET', identity: uami.id }
var slackSecrets = slackSecretAvailable ? [slackClientIdSecret, slackClientSecretSecret] : []
var slackEnv = slackSecretAvailable ? [
  { name: 'SLACK_CLIENT_ID', secretRef: 'slack-client-id' }
  { name: 'SLACK_CLIENT_SECRET', secretRef: 'slack-client-secret' }
] : []
// INT W2 (DEC-094): the Google app pair — the API only (OAuth start/exchange +
// token refresh); the SLACK pair pattern exactly. Calendly needs NO platform
// secret (fields connect: per-workspace PAT field-encrypted in the DB).
var googleClientIdSecret = { name: 'google-client-id', keyVaultUrl: '${kvUri}secrets/GOOGLE-CLIENT-ID', identity: uami.id }
var googleClientSecretSecret = { name: 'google-client-secret', keyVaultUrl: '${kvUri}secrets/GOOGLE-CLIENT-SECRET', identity: uami.id }
var googleSecrets = googleSecretAvailable ? [googleClientIdSecret, googleClientSecretSecret] : []
var googleEnv = googleSecretAvailable ? [
  { name: 'GOOGLE_CLIENT_ID', secretRef: 'google-client-id' }
  { name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
] : []
var webAppUrlEnv = empty(webAppUrl) ? [] : [{ name: 'WEB_APP_URL', value: webAppUrl }]
var integrationsWebhookBaseEnv = empty(integrationsWebhookBase) ? [] : [{ name: 'INTEGRATIONS_WEBHOOK_BASE', value: integrationsWebhookBase }]
var smsEnv = concat(
  [{ name: 'SMS_SANDBOX', value: smsSandbox }],
  smsAllowlistAvailable ? [{ name: 'CHANNELS_SMS_ALLOWLIST', secretRef: 'sms-allowlist' }] : []
)
// P3.1 (DEC-078): voice dialer wiring — same conditional discipline.
var voiceFromSecret = { name: 'voice-from-number', keyVaultUrl: '${kvUri}secrets/VOICE-FROM-NUMBER', identity: uami.id }
var voiceFromSecrets = voiceFromAvailable ? [voiceFromSecret] : []
var voiceAllowlistSecret = { name: 'voice-allowlist', keyVaultUrl: '${kvUri}secrets/VOICE-ALLOWLIST', identity: uami.id }
var voiceAllowlistSecrets = voiceAllowlistAvailable ? [voiceAllowlistSecret] : []
// P3.1 deploy (DEC-090): Container Apps FQDNs are deterministic
// (<app>.<env default domain>), which breaks the chicken-and-egg between the
// api's VOICE_SERVICE_URL and the voice app's own ingress — derived, never
// hand-configured; the explicit param stays as an override.
var voiceFqdn = '${voiceAppName}.${env.properties.defaultDomain}'
var voiceServiceBase = !empty(voiceServiceUrl) ? voiceServiceUrl : (deployVoiceService ? 'https://${voiceFqdn}' : '')
var voiceEnv = concat(
  [{ name: 'VOICE_SANDBOX', value: voiceSandbox }],
  empty(voiceServiceBase) ? [] : [{ name: 'VOICE_SERVICE_URL', value: voiceServiceBase }],
  voiceFromAvailable ? [{ name: 'VOICE_FROM_NUMBER', secretRef: 'voice-from-number' }] : [],
  voiceAllowlistAvailable ? [{ name: 'CHANNELS_VOICE_ALLOWLIST', secretRef: 'voice-allowlist' }] : []
)
var deepgramKeySecret = { name: 'deepgram-api-key', keyVaultUrl: '${kvUri}secrets/DEEPGRAM-API-KEY', identity: uami.id }

// ── API (NestJS) — external ingress :3001 ───────────────────────────────────
resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  identity: idConfig
  dependsOn: [kvRole, acrRole]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3001, transport: 'auto', allowInsecure: false }
      registries: registries
      secrets: concat([dbUrlSecret, appDbUrlSecret, authDevSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets, temporalSecrets, inboundTokenSecrets, sgWebhookKeySecrets, clerkApiSecrets, twilioSecrets, smsAllowlistSecrets, voiceFromSecrets, voiceAllowlistSecrets, slackSecrets, googleSecrets)
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acrLoginServer}/clientforce-api:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'PORT', value: '3001' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'APP_DATABASE_URL', secretRef: 'app-database-url' }
            { name: 'AUTH_DEV_SECRET', secretRef: 'auth-dev-secret' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            // The staging cache is OSS-cluster-policy: standalone clients get
            // MOVED on keys owned by other shards (2026-07-08 diagnosis) — this
            // flips @clientforce/events to ioredis Cluster clients.
            { name: 'REDIS_CLUSTER', value: 'true' }
            { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }
            { name: 'FIELD_ENCRYPTION_KEY', secretRef: 'field-encryption-key' }
            // §G phase rule: allow-listed test sends only (DEC-014 — the
            // allow-list REMAINS the recipient filter even when sandbox is off).
            { name: 'CHANNELS_ALLOWLIST', value: 'tronwebng@gmail.com' }
            // A3 (DEC-060a): env-controlled sandbox; 'true' everywhere except
            // an explicit production parameter — see the param description.
            { name: 'SENDGRID_SANDBOX', value: sendgridSandbox }
          ], storageEnv, temporalEnv, inboundTokenEnv, sgWebhookKeyEnv, clerkApiEnv, twilioEnv, smsEnv, voiceEnv, slackEnv, googleEnv, webAppUrlEnv, integrationsWebhookBaseEnv)
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ── Worker (Temporal) — no ingress, idle until Temporal mTLS lands ───────────
resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerAppName
  location: location
  identity: idConfig
  dependsOn: [kvRole, acrRole]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      // INT W2 (DEC-094): unlike Slack, the worker DOES need the Google app
      // pair — refreshing a workspace's expiring gcal token (the compose-time
      // freebusy/slots seam) requires the app client id+secret.
      secrets: concat([dbUrlSecret, appDbUrlSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets, temporalSecrets, twilioSecrets, smsAllowlistSecrets, zerobounceSecrets, googleSecrets)
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: '${acrLoginServer}/clientforce-worker:${imageTag}'
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: concat([
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'APP_DATABASE_URL', secretRef: 'app-database-url' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            // Same cluster flag as the api container — api and worker MUST
            // agree, or one side's queue writes land where the other can't read.
            { name: 'REDIS_CLUSTER', value: 'true' }
            { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }
            { name: 'FIELD_ENCRYPTION_KEY', secretRef: 'field-encryption-key' }
            { name: 'CHANNELS_ALLOWLIST', value: 'tronwebng@gmail.com' }
            { name: 'SENDGRID_SANDBOX', value: sendgridSandbox }
          ], storageEnv, temporalEnv, twilioEnv, smsEnv, zerobounceEnv, googleEnv)
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// ── Web (Next.js) — external ingress :3000, points at the API ───────────────
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  identity: idConfig
  dependsOn: [kvRole, acrRole]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: registries
      secrets: concat([authDevSecret], clerkWebSecrets)
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${acrLoginServer}/clientforce-web:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'PORT', value: '3000' }
            { name: 'AUTH_DEV_SECRET', secretRef: 'auth-dev-secret' }
            { name: 'API_URL', value: 'https://${api.properties.configuration.ingress.fqdn}' }
          ], clerkWebEnv)
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

// ── Voice call-session service (P3.1 deploy, DEC-090) — external ingress ────
// :8080, WebSocket media streams ride the same ingress (Container Apps
// supports ws on transport auto). Twilio reaches POST /twiml then opens
// wss://<fqdn>/media — both gated on the token derived from
// TWILIO-AUTH-TOKEN (never an open LLM/TTS bridge on a public FQDN).
// Single replica: a call is one long-lived socket pinned to its replica;
// scale-out needs no cross-replica state but staging load is one demo call.
// D11's §2.7 latency-by-measurement stands: this staging placement is the
// measuring instrument, not the go-live placement ruling.
resource voice 'Microsoft.App/containerApps@2024-03-01' = if (deployVoiceService) {
  name: voiceAppName
  location: location
  identity: idConfig
  dependsOn: [kvRole, acrRole]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false }
      registries: registries
      secrets: concat([appDbUrlSecret, redisUrlSecret, anthropicKeySecret, deepgramKeySecret], twilioSecrets)
    }
    template: {
      containers: [
        {
          name: 'voice'
          image: '${acrLoginServer}/clientforce-voice:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat([
            { name: 'PORT', value: '8080' }
            // The service renders its own TwiML/wss URLs from this host.
            { name: 'PUBLIC_HOST', value: voiceFqdn }
            // Product mode: transcripts/Call finalize through the RLS-subject
            // client only (withTenant) — never the owner client.
            { name: 'APP_DATABASE_URL', secretRef: 'app-database-url' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'DEEPGRAM_API_KEY', secretRef: 'deepgram-api-key' }
            { name: 'REDIS_URL', secretRef: 'redis-url' }
            // Same cluster flag as api/worker — the events bus MUST agree.
            { name: 'REDIS_CLUSTER', value: 'true' }
            // Per-call metrics dump — container-local scratch, evidence
            // surfaces via the numbers-only `[metrics] summary` log line.
            { name: 'METRICS_OUT', value: '/tmp/metrics.json' }
          ], twilioSecretsAvailable ? [
            // The /twiml + /media access gate (deriveVoiceMediaToken).
            { name: 'TWILIO_AUTH_TOKEN', secretRef: 'twilio-auth-token' }
          ] : [])
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// ── Migration job (prisma migrate deploy + seed), triggered by the pipeline ──
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: migrateJobName
  location: location
  identity: idConfig
  dependsOn: [kvRole, acrRole]
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 1
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registries
      secrets: [dbUrlSecret]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${acrLoginServer}/clientforce-migrate:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [{ name: 'DATABASE_URL', secretRef: 'database-url' }]
        }
      ]
    }
  }
}

output apiFqdn string = api.properties.configuration.ingress.fqdn
output webFqdn string = web.properties.configuration.ingress.fqdn
output migrateJobName string = migrateJob.name
// Deterministic (not read off the conditional resource — that would fail the
// deployment when deployVoiceService is false).
output voiceFqdn string = deployVoiceService ? voiceFqdn : ''
