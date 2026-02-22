; alter - Process Manager
; Inno Setup Script
; https://github.com/thechandanbhagat/alter-pm

#define AppName      "alter"
#define AppVersion   "0.1.0"
#define AppPublisher "thechandanbhagat"
#define AppURL       "https://github.com/thechandanbhagat/alter-pm"
#define AppExeName   "alter.exe"
#define BinaryDir    "..\target\release"

[Setup]
; AppId uniquely identifies this application — do NOT change after first release
AppId={{B7C4D3E2-F1A0-4B5C-9D8E-2F3A1B4C5D6E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=..\LICENSE
OutputDir=..\dist
OutputBaseFilename=alter-{#AppVersion}-windows-x64-setup
SetupIconFile=
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline

; Windows 10 1809+ required
MinVersion=10.0.17763

; Uninstall info
UninstallDisplayName={#AppName} {#AppVersion}
UninstallDisplayIcon={app}\{#AppExeName}

; Architecture — x64 only
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "addtopath"; Description: "Add alter to PATH (recommended)"; GroupDescription: "System integration:"; Flags: checked

[Files]
; Main binary
Source: "{#BinaryDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; No start menu shortcut needed for a CLI tool — just a modern apps entry
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Registry]
; Add to PATH via registry so it persists across terminals
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; \
    ValueType: expandsz; ValueName: "Path"; \
    ValueData: "{olddata};{app}"; \
    Tasks: addtopath; Check: NeedsAddPath('{app}')

[Code]
// NeedsAddPath — returns True if {app} is not already in the system PATH
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
    'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  // Look for the path with or without trailing backslash
  Result := Pos(';' + Uppercase(Param) + ';', ';' + Uppercase(OrigPath) + ';') = 0;
end;

// After install, broadcast WM_SETTINGCHANGE so PATH is live without a reboot
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: integer;
begin
  if CurStep = ssPostInstall then begin
    Exec(ExpandConstant('{sys}\cmd.exe'),
      '/C setx /M PATH "%PATH%"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

[UninstallRun]
; Gracefully stop the daemon before uninstalling
Filename: "{app}\alter.exe"; Parameters: "daemon stop"; \
    Flags: runhidden; RunOnceId: "StopDaemon"
