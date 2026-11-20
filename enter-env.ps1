& {
    $androidSdk = $env:ANDROID_HOME
    if (-not $androidSdk) {
        $androidSdk = $env:ANDROID_SDK_ROOT
    }

    $toolDirectories = @()
    # Prefer checkout-local Python and the configured SDK/JDK over global tools.
    $venvScripts = Join-Path $PSScriptRoot '.venv\Scripts'
    if (Test-Path -LiteralPath (Join-Path $venvScripts 'python.exe') -PathType Leaf) {
        $toolDirectories += $venvScripts
    }
    if ($androidSdk) {
        $platformTools = Join-Path $androidSdk 'platform-tools'
        if (Test-Path -LiteralPath (Join-Path $platformTools 'adb.exe') -PathType Leaf) {
            $toolDirectories += $platformTools
        } else {
            Write-Warning 'adb.exe is missing from the configured SDK platform-tools. Check ANDROID_HOME and install Android SDK Platform-Tools.'
        }
    }
    if ($env:JAVA_HOME) {
        $javaBin = Join-Path $env:JAVA_HOME 'bin'
        if (Test-Path -LiteralPath (Join-Path $javaBin 'javac.exe') -PathType Leaf) {
            $toolDirectories += $javaBin
        } else {
            Write-Warning 'javac.exe is missing from the configured JDK. Set JAVA_HOME to the JDK root if building the APK.'
        }
    }

    if ($toolDirectories.Count -gt 0) {
        $separator = [IO.Path]::PathSeparator
        $existing = @($env:Path -split $separator | Where-Object { $_ -and $_ -notin $toolDirectories })
        $env:Path = ($toolDirectories + $existing) -join $separator
    }

    if (-not (Get-Command adb -CommandType Application -ErrorAction SilentlyContinue)) {
        Write-Warning 'ADB is not available. Set ANDROID_HOME or add Android SDK Platform-Tools to PATH, then rerun enter-env.ps1.'
    }
    if ($env:PERFETTO_BINARY -and -not (Test-Path -LiteralPath $env:PERFETTO_BINARY -PathType Leaf)) {
        Write-Warning 'PERFETTO_BINARY does not point to a file. Set it to a Trace Processor executable or unset it to use the SDK default.'
    }
}
