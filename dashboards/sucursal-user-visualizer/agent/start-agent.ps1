# start-agent.ps1
# Ejecutar manualmente despues de un reinicio para levantar el agente.

$AgentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EcoFile  = "$AgentDir\ecosystem.config.cjs"

pm2 start $EcoFile
pm2 status
