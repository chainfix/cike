; Inno Setup script for the CIKE Windows installer.
; Built in CI with:
;   ISCC.exe /DAppVersion=x.y.z /DSourceDir=<packaged app dir> /O<output dir> electron\installer.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\CIKE-win32-x64"
#endif

[Setup]
AppId={{4A672DDD-B9BC-4539-881C-07C16E2678BD}
AppName=CIKE
AppVersion={#AppVersion}
AppVerName=CIKE {#AppVersion}
AppPublisher=CIKE
AppPublisherURL=https://github.com/chainfix/cike
AppSupportURL=https://github.com/chainfix/cike/issues
DefaultDirName={autopf}\CIKE
DefaultGroupName=CIKE
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=CIKE-{#AppVersion}-win-x64-setup
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\CIKE.exe
UninstallDisplayName=CIKE
VersionInfoVersion={#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\CIKE"; Filename: "{app}\CIKE.exe"
Name: "{autodesktop}\CIKE"; Filename: "{app}\CIKE.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\CIKE.exe"; Description: "{cm:LaunchProgram,CIKE}"; Flags: nowait postinstall skipifsilent
