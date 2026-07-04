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
      secrets: concat([dbUrlSecret, appDbUrlSecret, authDevSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets)
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
            { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }
            { name: 'FIELD_ENCRYPTION_KEY', secretRef: 'field-encryption-key' }
            // §G phase rule: allow-listed test sends only; sandbox until P1.8.
            { name: 'CHANNELS_ALLOWLIST', value: 'tronwebng@gmail.com' }
            { name: 'CHANNELS_SANDBOX', value: 'true' }
          ], storageEnv)
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
      secrets: concat([dbUrlSecret, appDbUrlSecret, redisUrlSecret, openaiKeySecret, anthropicKeySecret, sendgridKeySecret, fieldEncKeySecret], storageSecrets)
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
            { name: 'OPENAI_API_KEY', secretRef: 'openai-api-key' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            { name: 'SENDGRID_API_KEY', secretRef: 'sendgrid-api-key' }
            { name: 'FIELD_ENCRYPTION_KEY', secretRef: 'field-encryption-key' }
            { name: 'CHANNELS_ALLOWLIST', value: 'tronwebng@gmail.com' }
            { name: 'CHANNELS_SANDBOX', value: 'true' }
          ], storageEnv)
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
      secrets: [authDevSecret]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${acrLoginServer}/clientforce-web:${imageTag}'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'PORT', value: '3000' }
            { name: 'AUTH_DEV_SECRET', secretRef: 'auth-dev-secret' }
            { name: 'API_URL', value: 'https://${api.properties.configuration.ingress.fqdn}' }
          ]
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
