/**
 * A program's own window, by the labels on it: read its controls, set one, press one.
 *
 * Through the system's accessibility layer — UI Automation on Windows, System Events
 * on a Mac. Not on Linux.
 *
 * ⛔ A CONTROL IS FOUND BY ITS LABEL, never by where it is on the screen, in the front
 *    window of the one program that was named.
 * ⛔ THE SCRIPTS ARE FIXED TEXT. The program, the label and the value reach them as
 *    data (environment variables on Windows, arguments on a Mac) and are never joined
 *    into the script.
 * ⛔ A PASSWORD FIELD is never read and never filled. The script checks on the machine
 *    and refuses, whatever was asked.
 *
 * ⚠️ On a Mac the terminal running the helper needs Accessibility permission (System
 *    Settings → Privacy & Security → Accessibility). Without it every action answers
 *    `not_permitted`.
 */
import type { ActionResult, Exec, Platform } from './helper-actions';

export type UiMode = 'read' | 'set' | 'press';
export const UI_TIMEOUT_MS = 10000;
const MAX_CONTROLS = 40;

// Single quotes only and no backtick: it is sent base64-encoded, so nothing on the way
// re-reads it, and nothing in it is built from an input.
export const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$T = [char]9
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $mode = $env:SOLID_UI_MODE
  $prog = $env:SOLID_UI_PROGRAM -replace '\\.exe$', ''
  $ctl = $env:SOLID_UI_CONTROL
  $val = $env:SOLID_UI_VALUE
  $p = Get-Process -Name $prog -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { 'ERR' + $T + 'program_not_running'; exit 0 }
  $AE = [System.Windows.Automation.AutomationElement]
  $Scope = [System.Windows.Automation.TreeScope]::Descendants
  $root = $AE::FromHandle($p.MainWindowHandle)
  $all = $root.FindAll($Scope, [System.Windows.Automation.Condition]::TrueCondition)
  function Kind($e) { return ($e.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', '') }
  function Val($e) {
    if ($e.Current.IsPassword) { return '(hidden)' }
    $o = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$o)) { return [string]$o.Current.Value }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$o)) { return [string]$o.Current.ToggleState }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern, [ref]$o)) {
      $s = $o.Current.GetSelection()
      if ($s.Length -gt 0) { return [string]$s[0].Current.Name }
    }
    return ''
  }
  if ($mode -eq 'read') {
    'WIN' + $T + ($root.Current.Name -replace '\\s+', ' ')
    $n = 0
    foreach ($e in $all) {
      $k = Kind $e
      if (@('Button', 'Edit', 'ComboBox', 'CheckBox', 'RadioButton', 'TabItem', 'MenuItem', 'List', 'Hyperlink') -notcontains $k) { continue }
      $name = [string]$e.Current.Name
      if (-not $name) { continue }
      'CTL' + $T + $k + $T + ($name -replace '\\s+', ' ') + $T + ((Val $e) -replace '\\s+', ' ')
      $n++
      if ($n -ge 60) { break }
    }
    exit 0
  }
  if ($mode -eq 'set') {
    foreach ($e in $all) {
      $k = Kind $e
      if (@('Edit', 'ComboBox') -notcontains $k) { continue }
      if ([string]$e.Current.Name -ne $ctl) { continue }
      if ($e.Current.IsPassword) { 'ERR' + $T + 'password_field'; exit 0 }
      $o = $null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$o) -and (-not $o.Current.IsReadOnly)) {
        $o.SetValue($val)
      } elseif ($k -eq 'ComboBox') {
        $x = $null
        if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$x)) { $x.Expand() }
        $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, $val)
        $item = $e.FindFirst($Scope, $cond)
        if (-not $item) { if ($x) { $x.Collapse() }; 'ERR' + $T + 'value_not_offered'; exit 0 }
        $s = $null
        if ($item.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$s)) { $s.Select() }
        if ($x) { $x.Collapse() }
      } else { 'ERR' + $T + 'control_read_only'; exit 0 }
      'OK' + $T + ((Val $e) -replace '\\s+', ' ')
      exit 0
    }
    'ERR' + $T + 'control_not_found'
    exit 0
  }
  if ($mode -eq 'press') {
    foreach ($e in $all) {
      $k = Kind $e
      if (@('Button', 'CheckBox', 'RadioButton', 'TabItem', 'MenuItem', 'Hyperlink') -notcontains $k) { continue }
      if ([string]$e.Current.Name -ne $ctl) { continue }
      if (-not $e.Current.IsEnabled) { 'ERR' + $T + 'control_disabled'; exit 0 }
      $o = $null
      if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$o)) { $o.Invoke() }
      elseif ($e.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$o)) { $o.Toggle() }
      elseif ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$o)) { $o.Select() }
      else { 'ERR' + $T + 'control_cannot_be_pressed'; exit 0 }
      'OK'
      exit 0
    }
    'ERR' + $T + 'control_not_found'
    exit 0
  }
  'ERR' + $T + 'unknown_mode'
} catch {
  'ERR' + $T + 'script' + $T + '0'
}
`;

// `on run argv`: the program, the label and the value arrive as arguments.
export const MAC_SCRIPT = `
on labelOf(el)
  tell application "System Events"
    set nm to missing value
    try
      set nm to name of el
    end try
    if nm is missing value or nm is "" then
      try
        set nm to description of el
      end try
    end if
    if nm is missing value then set nm to ""
    return nm as text
  end tell
end labelOf

on valueOf(el)
  tell application "System Events"
    set sr to ""
    try
      set sr to subrole of el
    end try
    if sr is "AXSecureTextField" then return "(hidden)"
    set v to ""
    try
      set v to (value of el) as text
    end try
    return v
  end tell
end valueOf

on run argv
  set mode to item 1 of argv
  set prog to item 2 of argv
  set ctl to ""
  set val to ""
  if (count of argv) > 2 then set ctl to item 3 of argv
  if (count of argv) > 3 then set val to item 4 of argv
  try
    tell application "System Events"
      if not (exists application process prog) then return "ERR" & tab & "program_not_running"
      tell application process prog
        if (count of windows) is 0 then return "ERR" & tab & "no_window"
        set w to window 1
        set wname to ""
        try
          set wname to (name of w) as text
        end try
        set els to entire contents of w
      end tell
      if mode is "read" then
        set out to "WIN" & tab & wname
        set n to 0
        repeat with el in els
          set r to ""
          try
            set r to role of el
          end try
          if r is in {"AXButton", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXComboBox", "AXMenuButton"} then
            set nm to my labelOf(el)
            if nm is not "" then
              set out to out & linefeed & "CTL" & tab & r & tab & nm & tab & my valueOf(el)
              set n to n + 1
              if n is greater than or equal to 60 then exit repeat
            end if
          end if
        end repeat
        return out
      end if
      if mode is "set" then
        repeat with el in els
          set r to ""
          try
            set r to role of el
          end try
          if r is in {"AXTextField", "AXTextArea", "AXComboBox", "AXPopUpButton"} then
            if my labelOf(el) is ctl then
              set sr to ""
              try
                set sr to subrole of el
              end try
              if sr is "AXSecureTextField" then return "ERR" & tab & "password_field"
              if r is "AXPopUpButton" then
                click el
                delay 0.3
                try
                  click menu item val of menu 1 of el
                on error
                  key code 53
                  return "ERR" & tab & "value_not_offered"
                end try
              else
                set value of el to val
              end if
              delay 0.2
              return "OK" & tab & my valueOf(el)
            end if
          end if
        end repeat
        return "ERR" & tab & "control_not_found"
      end if
      if mode is "press" then
        repeat with el in els
          set r to ""
          try
            set r to role of el
          end try
          if r is in {"AXButton", "AXCheckBox", "AXRadioButton", "AXMenuButton"} then
            if my labelOf(el) is ctl then
              set canPress to true
              try
                set canPress to enabled of el
              end try
              if canPress is false then return "ERR" & tab & "control_disabled"
              click el
              return "OK"
            end if
          end if
        end repeat
        return "ERR" & tab & "control_not_found"
      end if
    end tell
    return "ERR" & tab & "unknown_mode"
  on error errText number errNum
    return "ERR" & tab & "script" & tab & (errNum as text)
  end try
end run
`;

const KINDS: Record<string, string> = {
  AXButton: 'Button', AXMenuButton: 'Button', Button: 'Button', Hyperlink: 'Link',
  AXTextField: 'Field', AXTextArea: 'Field', Edit: 'Field',
  AXPopUpButton: 'List', AXComboBox: 'List', ComboBox: 'List', List: 'List',
  AXCheckBox: 'Tick box', CheckBox: 'Tick box', AXRadioButton: 'Option', RadioButton: 'Option',
  TabItem: 'Tab', MenuItem: 'Menu item',
};
// The system refused to let this program read or drive another one.
const NOT_PERMITTED = new Set(['-1719', '-25211', '-1743', '-10004']);
const REASONS = new Set(['program_not_running', 'no_window', 'control_not_found', 'password_field', 'value_not_offered',
  'control_read_only', 'control_disabled', 'control_cannot_be_pressed']);

const tidy = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

export type UiParsed = { error?: string; window?: string; controls?: string[]; ok?: boolean; value?: string };

/** PURE. What a script printed → what it means. Anything unreadable is a failure. */
export function uiFrom(stdout: string): UiParsed {
  const lines = stdout.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  if (!lines.length) return { error: 'could_not_read_window' };
  const first = lines[0].split('\t');
  if (first[0] === 'ERR') {
    if (first[1] === 'script') return { error: NOT_PERMITTED.has(first[2] || '') ? 'not_permitted' : 'could_not_read_window' };
    return { error: REASONS.has(first[1] || '') ? first[1] : 'could_not_read_window' };
  }
  if (first[0] === 'OK') return { ok: true, value: tidy(first.slice(1).join(' '), 120) };
  if (first[0] !== 'WIN') return { error: 'could_not_read_window' };
  const controls: string[] = [];
  for (const line of lines.slice(1)) {
    const [tag, kind, name, value] = line.split('\t');
    if (tag !== 'CTL' || !name || controls.length >= MAX_CONTROLS) continue;
    const held = tidy(value || '', 60);
    controls.push(`${KINDS[kind] || 'Control'}: ${tidy(name, 50)}${held ? ` = ${held}` : ''}`);
  }
  return { window: tidy(first.slice(1).join(' '), 80), controls };
}

async function runScript(mode: UiMode, platform: Platform, inputs: Record<string, string>, exec: Exec): Promise<UiParsed> {
  if (platform === 'windows') {
    const out = await exec('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64')],
      { env: { SOLID_UI_MODE: mode, SOLID_UI_PROGRAM: inputs.program, SOLID_UI_CONTROL: inputs.control || '', SOLID_UI_VALUE: inputs.value || '' },
        timeoutMs: UI_TIMEOUT_MS });
    return uiFrom(out.stdout);
  }
  const args = ['-e', MAC_SCRIPT, mode, inputs.program];
  if (mode !== 'read') args.push(inputs.control || '');
  if (mode === 'set') args.push(inputs.value || '');
  return uiFrom((await exec('osascript', args, { timeoutMs: UI_TIMEOUT_MS })).stdout);
}

/** Run one window action. `inputs` have already been checked against the catalog. */
export async function runUi(action: string, inputs: Record<string, string>, platform: Platform, exec: Exec): Promise<ActionResult> {
  if (platform === 'linux') return { ok: false, reason: 'not_supported_on_this_system' };
  const mode: UiMode = action === 'ui.read' ? 'read' : action === 'ui.set' ? 'set' : 'press';
  const got = await runScript(mode, platform, inputs, exec);
  if (got.error) return { ok: false, reason: got.error };
  if (mode === 'read') {
    return { ok: true, data: { program: inputs.program, window: got.window || '', count: (got.controls || []).length, controls: got.controls || [] } };
  }
  if (!got.ok) return { ok: false, reason: 'could_not_read_window' };
  if (mode === 'press') return { ok: true, data: { program: inputs.program, pressed: inputs.control } };
  // What was asked is not what happened: the script reads the field back after setting it.
  if ((got.value || '') !== inputs.value) {
    return { ok: false, reason: 'value_did_not_change', data: { control: inputs.control, holds: got.value || '' } };
  }
  return { ok: true, data: { program: inputs.program, control: inputs.control, holds: got.value || '' } };
}
