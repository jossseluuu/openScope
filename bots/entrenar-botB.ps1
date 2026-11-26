<#
.SYNOPSIS
    Entrena el Bot B (codificación v8) de principio a fin: imitación del Bot A + puerta + PPO.

.DESCRIPTION
    Impide que Windows suspenda el equipo mientras dura (sin cambiar la configuración de energía), guarda el
    registro en bots/runs/botB/entrenamiento-<fecha>.log y, al acabar, evalúa el mejor modelo contra el Bot A
    y lo exporta a ONNX. Ver docs/bots/entrenamiento.md.

.PARAMETER Resume
    Continúa PPO desde el último punto guardado (ppo_checkpoint.pt) en vez de empezar desde la imitación.

.PARAMETER SkipCheck
    Pasa a PPO aunque la imitación no supere la puerta contra el Bot A (80 % de sus aterrizajes).

.PARAMETER MaxUpdates
    Limita el número de actualizaciones de PPO (0 = las del currículo, unas 1000).

.EXAMPLE
    .\bots\entrenar-botB.ps1
    .\bots\entrenar-botB.ps1 -Resume
    .\bots\entrenar-botB.ps1 -SkipCheck -MaxUpdates 100
#>
param(
    [switch]$Resume,
    [switch]$SkipCheck,
    [int]$MaxUpdates = 0
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $PSScriptRoot 'python'
$venv = Join-Path $python '.venv\Scripts\python.exe'
$runs = Join-Path $PSScriptRoot 'runs\botB'

if (-not (Test-Path $venv)) {
    Write-Host 'Falta el entorno de Python. Créalo antes (docs/bots/entrenamiento.md, "Preparación"):' -ForegroundColor Red
    Write-Host '  cd bots\python; python -m venv .venv; .venv\Scripts\pip install -r requirements.txt'
    exit 1
}

New-Item -ItemType Directory -Force $runs | Out-Null
$log = Join-Path $runs ("entrenamiento-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmm'))

# ES_CONTINUOUS | ES_SYSTEM_REQUIRED: el equipo no se suspende mientras este proceso viva
Add-Type -Namespace OpenScope -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
[OpenScope.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

$trainArgs = @('-m', 'openscope_bots.train', '--config', '../configs/default.json')
if ($Resume) { $trainArgs += @('--stage', 'ppo', '--resume') }
if ($SkipCheck) { $trainArgs += '--skip-check' }
if ($MaxUpdates -gt 0) { $trainArgs += @('--max-updates', $MaxUpdates) }

Push-Location $python
try {
    Write-Host "Entrenando el Bot B. Registro: $log" -ForegroundColor Cyan
    & $venv @trainArgs 2>&1 | Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) {
        throw "El entrenamiento terminó con código $LASTEXITCODE (ver $log)"
    }

    $best = Join-Path $runs 'best.pt'
    if (Test-Path $best) {
        Write-Host 'Comparando el mejor modelo con el Bot A (protocolo de evaluación)...' -ForegroundColor Cyan
        & $venv -m openscope_bots.evaluate --model $best --airports lemd lemg eddm egcc klax --seeds 4 5 6 --minutes 60 2>&1 | Tee-Object -FilePath $log -Append
        Write-Host 'Exportando a ONNX para el navegador...' -ForegroundColor Cyan
        & $venv -m openscope_bots.export_onnx --model $best 2>&1 | Tee-Object -FilePath $log -Append
    } else {
        Write-Host 'No hay best.pt todavía (¿no pasó la puerta de imitación?). Revisa el registro.' -ForegroundColor Yellow
    }
} finally {
    Pop-Location
    [OpenScope.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
}
