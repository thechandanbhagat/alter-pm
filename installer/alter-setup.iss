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

; We modify the system PATH, so have Setup/Uninstall broadcast WM_SETTINGCHANGE
; on our behalf. This is the ONLY supported way to make the change live without a
; reboot. Do not shell out to `setx` to do it: setx silently truncates its value at
; 1024 characters, writes REG_SZ over the REG_EXPAND_SZ Path value, and expands the
; caller's merged process PATH (machine + user), so it destroys the machine PATH on
; any box whose PATH is longer than 1024 chars. See issue #11.
ChangesEnvironment=yes

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
Name: "addtopath"; Description: "Add alter to PATH (recommended)"; GroupDescription: "System integration:"

[Files]
; Main binary
Source: "{#BinaryDir}\{#AppExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; No start menu shortcut needed for a CLI tool — just a modern apps entry
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Registry]
; Add to PATH via registry so it persists across terminals. {olddata} appends to the
; existing value rather than replacing it, and the expandsz type is preserved so other
; segments such as %SystemRoot%\system32 keep expanding.
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"; \
    ValueType: expandsz; ValueName: "Path"; \
    ValueData: "{olddata};{app}"; \
    Tasks: addtopath; Check: NeedsAddPath('{app}')

[Code]
const
  EnvKey = 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment';
  BackupKey = 'Software\{#AppPublisher}\{#AppName}';

// Normalise a PATH segment for comparison: trimmed, upper-cased, no trailing
// backslash, so 'C:\Program Files\alter\' and 'C:\Program Files\alter' match.
// The loop tests the length before indexing rather than relying on `and` to
// short-circuit, which Pascal Script does not guarantee.
function NormalizeSeg(S: string): string;
begin
  Result := Uppercase(Trim(S));
  while Length(Result) > 0 do begin
    if Result[Length(Result)] <> '\' then
      Break;
    Result := Copy(Result, 1, Length(Result) - 1);
  end;
end;

// Split off the next ';'-delimited segment of Rest, returning it and advancing Rest.
function NextSeg(var Rest: string): string;
var
  P: integer;
begin
  P := Pos(';', Rest);
  if P > 0 then begin
    Result := Copy(Rest, 1, P - 1);
    Rest := Copy(Rest, P + 1, Length(Rest) - P);
  end else begin
    Result := Rest;
    Rest := '';
  end;
end;

// True when Dir already appears as a segment of PathValue.
function PathHasDir(PathValue, Dir: string): boolean;
var
  Rest, Seg, Target: string;
begin
  Result := False;
  Target := NormalizeSeg(Dir);
  if Target = '' then
    exit;
  Rest := PathValue;
  repeat
    Seg := NextSeg(Rest);
    if NormalizeSeg(Seg) = Target then begin
      Result := True;
      exit;
    end;
  until Rest = '';
end;

// PathValue with every occurrence of Dir removed. Segments that are kept retain their
// original text; empty segments are dropped, which also cleans up the stray ';;' left
// behind by older installers.
function RemoveDirFromPath(PathValue, Dir: string): string;
var
  Rest, Seg, Target: string;
begin
  Result := '';
  Target := NormalizeSeg(Dir);
  Rest := PathValue;
  repeat
    Seg := NextSeg(Rest);
    if (Trim(Seg) <> '') and (NormalizeSeg(Seg) <> Target) then begin
      if Result <> '' then
        Result := Result + ';';
      Result := Result + Seg;
    end;
  until Rest = '';
end;

// NeedsAddPath — Check function for the [Registry] PATH entry above. Returns True only
// when {app} is not already on the system PATH. Compared segment-by-segment so a
// trailing backslash on an existing entry does not produce a duplicate.
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE, EnvKey, 'Path', OrigPath) then begin
    Result := True;
    exit;
  end;
  Result := not PathHasDir(OrigPath, Param);
end;

// Stash the machine PATH as it was before we touched it. Kept after uninstall on
// purpose: it is the recovery copy if a PATH edit ever goes wrong again.
procedure CurStepChanged(CurStep: TSetupStep);
var
  OrigPath: string;
begin
  if CurStep <> ssInstall then
    exit;
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, EnvKey, 'Path', OrigPath) then
    RegWriteStringValue(HKEY_LOCAL_MACHINE, BackupKey, 'PathBackup', OrigPath);
end;

// Take {app} back out of the system PATH on uninstall. Written with
// RegWriteExpandStringValue so the value keeps its REG_EXPAND_SZ type.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir, OrigPath, NewPath: string;
begin
  if CurUninstallStep <> usPostUninstall then
    exit;
  AppDir := ExpandConstant('{app}');
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE, EnvKey, 'Path', OrigPath) then
    exit;
  if not PathHasDir(OrigPath, AppDir) then
    exit;
  NewPath := RemoveDirFromPath(OrigPath, AppDir);
  // Never write an empty PATH: if the computation collapsed, leave the value alone.
  if NewPath = '' then
    exit;
  RegWriteExpandStringValue(HKEY_LOCAL_MACHINE, EnvKey, 'Path', NewPath);
end;

[UninstallRun]
; Gracefully stop the daemon before uninstalling
Filename: "{app}\alter.exe"; Parameters: "daemon stop"; \
    Flags: runhidden; RunOnceId: "StopDaemon"
