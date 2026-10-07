param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9.-]+$')]
  [string]$Server
)

$ErrorActionPreference = 'Stop'
$identity = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
if (-not (Test-Path -LiteralPath $identity)) {
  throw 'The SSH identity was not found.'
}

$secure = Read-Host 'Enter the managed Supabase database password (not your login password)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $password | & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o IdentitiesOnly=yes -i $identity "root@$Server" node /opt/puddle-stage/self-host-receive-source-db-password.mjs
  if ($LASTEXITCODE -ne 0) { throw 'The private password transfer failed.' }
} finally {
  $password = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}
