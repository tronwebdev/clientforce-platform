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

@description('P3.1 (DEC-078): the deployed voice service public https base (empty until the voice container ships — Azure placement is measured-latency-driven, ARCHITECTURE §2.7; the cert/demo rig runs it on a runner meanwhile).')
param voiceServiceUrl string = ''

param apiAppName string = 'clientforce-api'
param workerAppName string = 'clientforce-worker'
param webAppName string = 'clientforce-web'
param migrateJobName string = 'clientforce-migrate'

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
var smsEnv = concat(
  [{ name: 'SMS_SANDBOX', value: smsSandbox }],
  smsAllowlistAvailable ? [{ name: 'CHANNELS_SMS_ALLOWLIST', secretRef: 'sms-allowlist' }] : []
)
// P3.1 (DEC-078): voice dialer wiring — same conditional discipline.
var voiceFromSecret = { name: 'voice-from-number', keyVaultUrl: '${kvUri}secrets/VOICE-FROM-NUMBER', identity: uami.id }
var voiceFromSecrets = voiceFromAvailable ? [voiceFromSecret] : []
var voiceAllowlistSecret = { name: 'voice-allowlist', keyVaultUrl: '${kvUri}secrets/VOICE-ALLOWLIST', identity: uami.id }
var voiceAllowlistSecrets = voiceAllowlistAvailable ? [voiceAllowlistSecret] : []
var voiceEnv = concat(
  [{ name: 'VOICE_SANDBOX', value: voiceSandbox }],
  empty(voiceServiceUrl) ? [] : [{ name: 'VOICE_SERVICE_URL', value: voiceServiceUrl }],
  voiceFromAvailable ? [{ name: 'VOICE_FROM_NUMBER', secretRef: 'voice-from-number' }] : [],
  voiceAllowlistAvailable ? [{ name: 'CHANNELS_VOICE_ALLOWLIST', secretRef: 'voice-allowlist' }] : []
)

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
      secrets: concat([dbUrlSecret, appDbUrlSecret, authDevSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets, temporalSecrets, inboundTokenSecrets, sgWebhookKeySecrets, clerkApiSecrets, twilioSecrets, smsAllowlistSecrets, voiceFromSecrets, voiceAllowlistSecrets)
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
          ], storageEnv, temporalEnv, inboundTokenEnv, sgWebhookKeyEnv, clerkApiEnv, twilioEnv, smsEnv, voiceEnv)
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
      secrets: concat([dbUrlSecret, appDbUrlSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets, temporalSecrets, twilioSecrets, smsAllowlistSecrets)
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
          ], storageEnv, temporalEnv, twilioEnv, smsEnv)
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
