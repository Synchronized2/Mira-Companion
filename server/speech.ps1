$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$stream = New-Object System.IO.MemoryStream
try {
    $voices = @($synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled })
    if ($payload.list) {
        @($voices | ForEach-Object { @{ name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name } }) | ConvertTo-Json -Compress
    }
    else {
        $chosen = $voices | Where-Object { $_.VoiceInfo.Name -eq $payload.voice } | Select-Object -First 1
        if (-not $chosen) {
            $chosen = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
        }
        if ($chosen) { $synthesizer.SelectVoice($chosen.VoiceInfo.Name) }
        $synthesizer.Rate = [Math]::Max(-5, [Math]::Min(5, [int]$payload.rate))
        $synthesizer.SetOutputToWaveStream($stream)
        $synthesizer.Speak([string]$payload.text)
        $synthesizer.SetOutputToNull()
        [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
    }
}
finally {
    $synthesizer.Dispose()
    $stream.Dispose()
}
