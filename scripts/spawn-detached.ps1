param([Parameter(Mandatory = $true)][string]$Spec)
$ErrorActionPreference = 'Stop'
$spec = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not ([System.Management.Automation.PSTypeName]'DetachedSpawn').Type) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class DetachedSpawn {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow;
    public short cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess, hThread;
    public int dwProcessId, dwThreadId;
  }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CreateProcessW(
    string lpApplicationName,
    StringBuilder lpCommandLine,
    IntPtr lpProcessAttributes,
    IntPtr lpThreadAttributes,
    bool bInheritHandles,
    uint dwCreationFlags,
    IntPtr lpEnvironment,
    string lpCurrentDirectory,
    ref STARTUPINFO lpStartupInfo,
    out PROCESS_INFORMATION lpProcessInformation);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr handle);
}
'@
}
$pairs = New-Object System.Collections.Generic.List[string]
foreach ($property in $spec.env.PSObject.Properties) {
  $pairs.Add($property.Name + '=' + [string]$property.Value)
}
$envBlock = ([string]::Join([char]0, $pairs.ToArray())) + ([char]0) + ([char]0)
$ptr = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($envBlock)
$breakaway = [uint32]0x01000000 -bor 0x00000400 -bor 0x00000008 -bor 0x00000200 -bor 0x08000000
$plain = [uint32]0x00000400 -bor 0x00000008 -bor 0x00000200 -bor 0x08000000
$ok = $false
$pi = New-Object DetachedSpawn+PROCESS_INFORMATION
foreach ($flags in @($breakaway, $plain)) {
  $si = New-Object DetachedSpawn+STARTUPINFO
  $si.cb = [Runtime.InteropServices.Marshal]::SizeOf([type](New-Object DetachedSpawn+STARTUPINFO))
  $command = New-Object System.Text.StringBuilder ($spec.commandLine.Length + 16)
  [void]$command.Append($spec.commandLine)
  $ok = [DetachedSpawn]::CreateProcessW($null, $command, [IntPtr]::Zero, [IntPtr]::Zero, $false, $flags, $ptr, [string]$spec.cwd, [ref]$si, [ref]$pi)
  if ($ok) { break }
}
[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) | Out-Null
if (-not $ok) { exit 1 }
[DetachedSpawn]::CloseHandle($pi.hProcess) | Out-Null
[DetachedSpawn]::CloseHandle($pi.hThread) | Out-Null
Write-Output $pi.dwProcessId
