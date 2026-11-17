[CmdletBinding(DefaultParameterSetName = 'Speak')]
param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Speak')]
    [string]$TextPath,

    [Parameter(Mandatory = $true, ParameterSetName = 'Speak')]
    [string]$OutputPath,

    [Parameter(ParameterSetName = 'Speak')]
    [string]$Voice,

    [Parameter(ParameterSetName = 'Speak')]
    [ValidateRange(-10, 10)]
    [int]$Rate = 2,

    [Parameter(Mandatory = $true, ParameterSetName = 'List')]
    [switch]$ListVoices
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    if ($ListVoices) {
        $synth.GetInstalledVoices() | ForEach-Object {
            [pscustomobject]@{
                Name = $_.VoiceInfo.Name
                Culture = $_.VoiceInfo.Culture.Name
                Enabled = $_.Enabled
            }
        }
        return
    }

    $resolvedText = (Resolve-Path -LiteralPath $TextPath).ProviderPath
    $text = [System.IO.File]::ReadAllText($resolvedText, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($text)) { throw 'The UTF-8 input text is empty.' }
    if ($Voice) { $synth.SelectVoice($Voice) }
    $synth.Rate = $Rate

    $resolvedOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
    $parentDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
    if (-not (Test-Path -LiteralPath $parentDirectory -PathType Container)) {
        throw 'Create the output directory before generating audio.'
    }
    if ([string]::Equals($resolvedText, $resolvedOutput, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'TextPath and OutputPath must be different files.'
    }

    $synth.SetOutputToWaveFile($resolvedOutput)
    $synth.Speak($text)
    $synth.SetOutputToNull()
    [pscustomobject]@{
        Path = $resolvedOutput
        Voice = $synth.Voice.Name
        Rate = $Rate
        Bytes = (Get-Item -LiteralPath $resolvedOutput).Length
    }
} finally {
    $synth.Dispose()
}
