@echo off
cd /d "%~dp0"
node figma.js evaluate "{\"code\": \"const c = await figma.variables.getVariableCollectionByIdAsync(\\\"VariableCollectionId:3fd98387dccb5fecfb62129fc0ad19e45c866613/1628:376\\\"); return c ? c.variableIds.length : 0;\"}"
