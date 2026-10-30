#!/usr/bin/env bash
# PostToolUse: avisa si se agrega un SDK de publicidad/analítica/tracking
# (Apple Kids Category, Google Families Policy, Ley 21.719 / 21.430).
f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0
case "$f" in
  */package.json|*/requirements*.txt|*/pyproject.toml|*/Podfile|*/build.gradle|*/build.gradle.kts|*/capacitor.config.*) ;;
  *) exit 0 ;;
esac
[ -f "$f" ] || exit 0
hits=$(grep -Eio '(firebase[-_/]?analytics|google-analytics|gtag|admob|google-mobile-ads|facebook|fbsdk|appsflyer|adjust|amplitude|mixpanel|segment|branch\.io|onesignal|crashlytics|sentry|hotjar|clarity|posthog|datadog)' "$f" | sort -u | tr '\n' ' ')
if [ -n "$hits" ]; then
  jq -n --arg h "$hits" '{hookSpecificOutput:{hookEventName:"PostToolUse",
    additionalContext:("ALERTA: el archivo editado menciona posibles SDKs de analítica, publicidad o monitoreo de terceros: " + $h + ". Esta es una app infantil (6–10 años): sin publicidad ni analítica de terceros que recolecte datos del niño. No lo mantengas sin confirmación explícita del usuario; revisa con el subagente child-safety-ai-reviewer.")}}'
fi
exit 0
