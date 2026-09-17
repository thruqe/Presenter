; =====================================================================
; Presenter - Inno Setup Compiler Script
; Modern Church Scripture & Song Presentation System (OBS & NDI)
; =====================================================================

#define MyAppName "Presenter"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Thruqe"
#define MyAppURL "https://github.com/Thruqe/Presenter"
#define MyAppExeName "Presenter.exe"
#define MyAppServerExeName "Presenter-Server.exe"
#define MyAppIcon "..\assets\icon.ico"

[Setup]
AppId={{8B49B90D-2C22-4D96-B44D-2B6BE946B289}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=..\dist
OutputBaseFilename=Presenter-Setup-x64
SetupIconFile={#MyAppIcon}
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardSmallImageFile=..\assets\icon-64.png

; 64-bit Architecture enforcement
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Installation privileges
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Close running instances gracefully
CloseApplications=yes
RestartApplications=no

; Detailed Windows PE Binary Metadata
VersionInfoVersion=1.0.0.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup - Modern Church Scripture & Song Presentation System
VersionInfoTextVersion={#MyAppVersion}
VersionInfoCopyright=Copyright (C) 2026 {#MyAppPublisher}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion=1.0.0.0
VersionInfoOriginalFileName=Presenter-Setup-x64.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "startmenuicon"; Description: "Create Start Menu Shortcuts"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Primary GUI Executable
Source: "..\dist\presenter-gui-windows-x64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
; Headless / Terminal Server Executable
Source: "..\dist\presenter-server-windows-x64.exe"; DestDir: "{app}"; DestName: "{#MyAppServerExeName}"; Flags: ignoreversion
; Application Icon
Source: "{#MyAppIcon}"; DestDir: "{app}"; DestName: "icon.ico"; Flags: ignoreversion
; Web UI & Output Assets
Source: "..\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
; SQLite Databases (Scripture KJV & Songs)
Source: "..\db\*"; DestDir: "{app}\db"; Flags: ignoreversion recursesubdirs createallsubdirs
; Documentation & License
Source: "..\README.md"; DestDir: "{app}"; Flags: ignoreversion isreadme
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: startmenuicon; Comment: "Launch Presenter Desktop Controller"
Name: "{group}\{#MyAppName} Server (Console)"; Filename: "{app}\{#MyAppServerExeName}"; IconFilename: "{app}\icon.ico"; Tasks: startmenuicon; Comment: "Launch Presenter Web & NDI Server in Terminal"
Name: "{group}\{#MyAppName} Web Control"; Filename: "http://localhost:1000/"; IconFilename: "{app}\icon.ico"; Tasks: startmenuicon; Comment: "Open Presenter in Web Browser"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"; IconFilename: "{app}\icon.ico"; Tasks: startmenuicon
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon; Comment: "Launch Presenter"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
