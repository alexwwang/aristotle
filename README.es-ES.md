

# Aristotle 🦉

[![CI](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml/badge.svg)](https://github.com/alexwwang/aristotle/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/alexwwang/aristotle?include_prereleases)](https://github.com/alexwwang/aristotle/releases)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-2854%20total-brightgreen)](./docs/testing.md)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19660780.svg)](https://doi.org/10.5281/zenodo.19660780)

Inglés | [中文](./README.zh-CN.md)

> *Conócete a ti mismo es el comienzo de toda sabiduría.* — Aristóteles

**Aristotle** es una habilidad (skill) de [OpenCode](https://github.com/opencode-ai/opencode): un agente de reflexión y aprendizaje de errores.

Actívalo con `/aristotle` para iniciar un subagente aislado que analice tu sesión en busca de errores del modelo, realice un análisis de causa raíz 5-Why y genere reglas en borrador (DRAFT). Revisa, confirma o modifica antes de que cualquier contenido se escriba en disco.

## Características

- **Arquitectura de Revelación Progresiva** — La habilidad carga solo lo necesario: enrutador (5.6 KB) → reflexión (4.6 KB) → revisión (6.8 KB). Cada fase se carga bajo demanda, sin desperdiciar contexto.
- **Reflexión Aislada** — El análisis se ejecuta en una sesión de fondo separada; el contexto de la sesión principal nunca se contamina.
- **Análisis de Causa Raíz 5-Why** — Clasificación estructurada de errores en 8 categorías (MISUNDERSTOOD_REQUIREMENT, ASSUMED_CONTEXT, PATTERN_VIOLATION, HALLUCINATION, INCOMPLETE_ANALYSIS, WRONG_TOOL_CHOICE, OVERSIMPLIFICATION, SYNTAX_API_ERROR)
- **Flujo de trabajo DRAFT → Revisión → Confirmación** — Las reglas se generan como borradores (DRAFT) con metadatos de ubicación; el usuario revisa en una sesión dedicada mediante `/aristotle review N`, confirma, revisa o rechaza.
- **Ubicación Precisa de Errores** — El parámetro `--focus` apunta a partes específicas de una sesión (último intercambio, alrededor del mensaje N, después de una palabra clave, solo errores, o análisis completo).
- **Re-reflexión** — Durante la revisión, el usuario puede solicitar un análisis más profundo sobre un error específico. Los metadatos del borrador (ID de sesión, rango de mensajes, fragmentos de error) permiten apuntar con precisión sin volver a escanear toda la sesión.
- **Seguimiento de Estado** — `~/.config/opencode/aristotle-state.json` rastrea todas las reflexiones con su estado (borrador → confirmado → revisado), permitiendo que `/aristotle sessions` liste y gestione el historial.
- **Bilingüe** — Detecta patrones de corrección de errores en inglés y chino (zh-CN).
- **Salida de Dos Niveles** — Las reglas de nivel de usuario (`~/.config/opencode/aristotle-learnings.md`) se aplican globalmente; las reglas de nivel de proyecto (`.opencode/aristotle-project-learnings.md`) se aplican por proyecto.
- **Sugerencia Automática** — La descripción de la habilidad incluye palabras clave de corrección de errores; cuando se detectan en la conversación, la IA puede sugerir ejecutar `/aristotle` (automático, sin configuración necesaria).
- **Plugin** — Ensambla la biblioteca Core y el rol de Aristotle en un punto de entrada de plugin de OpenCode (`plugin/index.ts`). Proporciona reflexión en segundo plano basada en sondeo (polling), detección de inactividad y soporte para `/undo`.
- **Arquitectura de Doble Paquete** — La Fase 0 extrajo una biblioteca compartida `packages/core/` (registrador, configuración, almacén de flujos de trabajo, registro de plugins) y un paquete específico del rol `packages/aristotle/` (manejador de inactividad, extractor de instantáneas). El plugin los compone mediante `assemblePlugin()`, habilitando la reutilización en otras habilidades de OpenCode sin acoplamiento a la lógica específica de Aristotle. El Puente Watchdog-Intervention añade `packages/watchdog/` (aplicación de TDD en TypeScript) emparejado con `intervention/` (respuesta a violaciones internas de Python MCP).
- **Pipeline de TDD Protegido por Máquina de Estados** — Cuando se empareja con la [habilidad tdd-pipeline](https://github.com/opencode-ai/opencode) (≥ v0.17.0), la máquina de estados de vigilancia (watchdog) de Aristotle aplica la disciplina Red-Green-Refactor a lo largo de entregas de proyecto multifásicas. El pipeline cubre Diseño de Producto → Solución Técnica → Plan de Pruebas → Código de Pruebas → Código de Negocio → Pruebas Pre-Lanzamiento → Auditoría de Calidad del Sistema → Aceptación Funcional. Dadas requisitos claros, puede producir entregables de alta calidad y completamente probados con intervención humana mínima; la máquina de estados controla cada transición de fase, evitando regresiones de calidad.
- **Puente Watchdog-Intervention** — Conecta un Watchdog de TypeScript (`packages/watchdog/`) que intercepta llamadas de herramientas de LLM mediante ganchos `onToolBefore`/`onIdle` con un motor de Intervención de Python (`intervention/`) que aplica respuestas a violaciones mediante herramientas de servidor MCP. El Puente añade 4 capacidades: traducción de señales (21 tipos de señales de detección), máquina de estados de pipeline (pila suspendida con anidamiento MAX_DEPTH=10), ensamblaje de prompts MCP (plantillas de subagente T-1..T-10 + T-7b con Revisión de Doble Paso) y motor de cuarentena (cuarentena a nivel de archivo con metadatos respaldados por git). Detecta 14 tipos de violaciones (de proceso, conductuales, regresión, cumplimiento) a través de 53 criterios de aceptación. Incluye validación bilingüe (EN/ZH) de prompts del bucle Ralph, verificación de autoridad de pipeline protegida (GPAV), escáner de prompts de revisión (RPS) con 12 patrones prohibidos, y Revisión de Doble Paso (Recuerdo → Recopilación de Hechos → Precisión → Evaluación/Corrección). El Puente ahora incluye una capa de subproceso en tiempo de ejecución que conecta la detección de TypeScript con la aplicación de Python mediante llamadas MCP por lotes en cada límite de punto de control.

## Instalación

Aristotle tiene tres componentes, todos instalados desde el mismo repositorio:

1. **Habilidad (Skill)** — Archivos de protocolo cargados por OpenCode (`SKILL.md`, `REFLECT.md`, etc.)
2. **Servidor MCP** — Gestión de reglas respaldada por Git en Python (`aristotle_mcp/`)
3. **Plugin** — Reflexión asíncrona en TypeScript ensamblada desde `packages/core/` + `packages/reflection/` (`plugin/index.ts`). Proporciona reflexión en segundo plano basada en sondeo con detección de inactividad.

### Prerrequisitos

| Componente | Requerido | Opcional |
|-----------|----------|----------|
| Habilidad (Skill) | — | — |
| Servidor MCP | Python 3.10+, [uv](https://docs.astral.sh/uv/) | — |
| Plugin | [bun](https://bun.sh/) (para construir desde el código fuente) | — |

> El instalador (`install.sh`) omitirá la compilación del Plugin si no encuentra `bun` y continuará con la Habilidad + Servidor MCP. Puedes instalar bun más tarde y volver a ejecutar el instalador para añadir el Plugin.

### Opción 1: Instalación Manual (macOS / Linux)

```bash
# 1. Clona el repositorio
git clone https://github.com/alexwwang/aristotle.git /tmp/aristotle
cd /tmp/aristotle

# 2. Ejecuta el instalador (despliega SKILL.md + servidor MCP + Plugin)
bash scripts/install.sh

# 3. Añade la configuración MCP a opencode.json
# Consulta la sección "Configuración MCP" más abajo para el fragmento JSON

# 4. Registra el Plugin en opencode.json
# Añade al array "plugin": "file://$HOME/.config/opencode/aristotle-bridge/index.js"
```

### Opción 2: Instalación Manual (Windows)

```powershell
# 1. Clona el repositorio
git clone https://github.com/alexwwang/aristotle.git "$env:TEMP\aristotle"

# 2. Ejecuta el instalador (despliega SKILL.md + servidor MCP + Plugin)
cd "$env:TEMP\aristotle"
powershell -ExecutionPolicy Bypass -File scripts/install.ps1

# 3. Añade la configuración MCP a opencode.json
# Consulta la sección "Configuración MCP" más abajo para el fragmento JSON

# 4. Registra el Plugin en opencode.json
# Añade al array "plugin": "file://$env:USERPROFILE\.config\opencode\aristotle-bridge\index.js"
```

### Opción 3: Clon en una Línea (solo habilidad, sin MCP)

OpenCode descubre habilidades desde rutas configuradas en `opencode.json` (`skills.paths`):

```bash
mkdir -p ~/.config/opencode/skills/aristotle
curl -sL https://raw.githubusercontent.com/alexwwang/aristotle/main/SKILL.md -o ~/.config/opencode/skills/aristotle/SKILL.md
```

> **Nota:** Esto te da la habilidad básica sin servidor MCP. No obtendrás control de versiones Git, decisiones de auditoría Δ ni gestión del estado de las reglas. Ejecuta el instalador (`install.sh` o `install.ps1`) para desplegar el conjunto completo de características. El archivo de aprendizajes se creará automáticamente en la primera ejecución.

### Opción 4: Instalación Guiada (pega en OpenCode)

Copia y pega este prompt en cualquier sesión de OpenCode: instalará Aristotle por ti:

```
Install the Aristotle skill with MCP server from https://github.com/alexwwang/aristotle.git:
1. Clone to /tmp/aristotle
2. cd into the cloned directory, run `bash scripts/install.sh` (macOS/Linux) or `powershell -File scripts/install.ps1` (Windows)
3. Verify: run `bash scripts/test.sh` — all assertions must pass
4. Add MCP config to opencode.json: { "mcp": { "aristotle": { "type": "local", "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"], "enabled": true } } }
5. Register Plugin: add `"file://$HOME/.config/opencode/aristotle-bridge/index.js"` to the `"plugin"` array in opencode.json
6. Verify MCP: run `uv run --project ~/.config/opencode/aristotle python -c "from aristotle_mcp.server import mcp; print(len(mcp._tool_manager._tools), 'tools loaded')"` — should print "25 tools loaded"
```

> **Consejo:** También puedes instalar la habilidad mediante `opencode.json` sin clonar manualmente. Añade la URL del repositorio a `skills.urls`:
> ```jsonc
> {
>   "skills": {
>     "urls": ["https://github.com/alexwwang/aristotle.git"]
>   }
> }
> ```
> Luego reinicia OpenCode. La habilidad se obtendrá automáticamente. Aún deberás ejecutar `uv sync` y añadir la configuración MCP por separado.

### Opción 5: Docker (Linux/macOS con Colima/Docker Desktop)

Ejecuta Aristotle en un contenedor con OpenCode preinstalado. Toda la configuración y los datos se montan desde el host, manteniendo el contenedor sin estado.

**Prerrequisitos:** Docker + [Colima](https://github.com/abiosoft/colima) (macOS) o Docker Desktop (Linux/Windows)

```bash
# 1. Inicia Colima (ejemplo macOS)
colima start --cpu 2 --memory 4 --arch x86_64

# 2. Construye la imagen
docker compose build

# 3. Ejecuta el contenedor
docker compose run opencode-aristotle
```

**Volúmenes montados:**

| Ruta del Host | Ruta del Contenedor | Propósito |
|-----------|----------------|---------|
| `~/.config/opencode` | `/root/.config/opencode` | Configuración de OpenCode, habilidades, plugins, servidor MCP |
| `~/.local/share/opencode` | `/root/.local/share/opencode` | Datos de sesión, historial, estado |
| `~/workspace` | `/workspace` | Directorio de trabajo para proyectos |

**Diseño del Dockerfile:**
- Imagen base: `ghcr.io/anomalyco/opencode` (Alpine + CLI de opencode)
- Solo tiempo de ejecución: Python 3.12 + uv + bun + git
- **Sin componentes de Aristotle incluidos** — todos inyectados mediante montajes enlazados en tiempo de ejecución
- Punto de entrada: `opencode` (modo TUI)

### Configuración MCP

Añade esto a tu `opencode.json` para habilitar el servidor MCP (reemplaza `$HOME` con tu ruta de inicio real):

```jsonc
{
  "mcp": {
    "aristotle": {
      "type": "local",
      "command": ["uv", "run", "--project", "$HOME/.config/opencode/aristotle", "python", "-m", "aristotle_mcp.server"],
      "enabled": true
    }
  }
}
```

Personaliza la ubicación del repositorio de reglas con la variable de entorno `ARISTOTLE_REPO_DIR` (valor predeterminado: `~/.config/opencode/aristotle-repo/`).

## Uso

### Comandos

| Comando | Descripción |
|---------|-------------|
| `/aristotle` | Reflexiona sobre la sesión **actual** (enfocándose en el último intercambio) |
| `/aristotle last` | Reflexiona sobre la sesión **anterior** (ver Resolución de Objetivo más abajo) *(pendiente)* |
| `/aristotle session ses_xxx` | Reflexiona sobre una sesión específica por **ID de sesión de OpenCode** *(pendiente)* |
| `/aristotle recent N` | Reflexiona sobre la sesión **N** más reciente (N=1 es la más reciente, no la actual) *(pendiente)* |
| `/aristotle --focus <hint>` | Apunta a un área específica (ver Opciones de Enfoque más abajo) *(pendiente)* |
| `/aristotle --model <model>` | Anula el modelo para el Reflector *(pendiente — usará configuración en su lugar, ver más abajo)* |
| `/aristotle sessions` | Lista todos los registros de reflexión con estado y números de secuencia |
| `/aristotle review N` | Carga el borrador (DRAFT) **#N** en la sesión actual para revisión (N es el número de secuencia de `sessions`) |

> **Nota:** Los comandos marcados con *(pendiente)* son especificaciones documentadas que aún no se han implementado. Actualmente, `/aristotle` siempre reflexiona sobre la sesión actual con `focus: "last"`.

### Resolución de Objetivo

Aristotle usa `session_list` para resolver los objetivos de sesión. Las reglas son:

| Objetivo | Cómo se Resuelve |
|--------|-------------------|
| *(ninguno)* | Sesión actual — la sesión donde se está ejecutando `/aristotle` |
| `last` | La sesión inmediatamente anterior a la actual en la salida de `session_list`, independientemente de si está "abierta" o "cerrada". Las sesiones de OpenCode no tienen un estado completado/cerrado — se ordenan por último tiempo de actividad. |
| `session ses_xxx` | Búsqueda directa por ID de sesión de OpenCode (formato: prefijo `ses_` + alfanumérico). Este es el **ID de la sesión objetivo** (la sesión que contiene los errores), no el ID de sesión del Reflector. |
| `recent N` | La N-ésima entrada de `session_list`, excluyendo la sesión actual. `recent 1` = la sesión justo antes de la actual, `recent 3` = la tercera más reciente. Ejecuta **un** Reflector para esa única sesión. |

> **Nota:** Si tienes varias instancias de OpenCode abiertas, todas las sesiones aparecen en `session_list` ordenadas por último tiempo de actividad. `last` y `recent N` simplemente seleccionan de esta lista — no omiten sesiones "abiertas". Si quieres reflexionar sobre una sesión específica independientemente del orden, usa `session <id>`.

### Opciones de Enfoque (Focus)

Limita el rango de escaneo del Reflector dentro de la sesión objetivo:

| Pista de Enfoque | Comportamiento |
|------------|----------|
| `last` (predeterminado) | Últimos 50 mensajes de la sesión objetivo |
| `after "text"` | Desde la primera ocurrencia de "text" hasta el final de la sesión |
| `around N` | Mensajes N-10 a N+10 (ventana de 20 mensajes) |
| `error` | Escanea la sesión completa, pero solo extrae patrones de corrección de errores (omite secciones limpias) |
| `full` | Escanea la sesión completa (útil para sesiones cortas o revisiones exhaustivas) |

### Flujo de Trabajo de Revisión

1. **Lista reflexiones**: `/aristotle sessions` → muestra lista numerada con estado
2. **Elige una**: `/aristotle review 2` → carga la revisión enriquecida con puntuación de auditoría Δ, confianza/riesgo por regla, advertencias de conflicto y resumen del DRAFT
3. **Decide**: `confirm` / `revise 1: feedback` / `reject` / `re-reflect` / `inspect N` / `show draft`
4. **Itera**: repite para otras reflexiones, o solicita re-reflexión con análisis más profundo

> El número de secuencia (`N`) en `/aristotle review N` proviene de la columna `#` en la salida de `/aristotle sessions`. **No** es un ID de sesión de OpenCode — es la posición en la lista de registros de reflexión.

```
Fase de Reflexión                    Fase de Revisión
─────────────                    ────────────
/aristotle                       /aristotle review 1
  │                                │
  ├─ Carga REFLECT.md               ├─ Carga REVIEW.md
  │  (4.6 KB)                       │  (6.8 KB)
  │                                │
  ├─ Lanza Reflector ──────►        ├─ Lee sesión del Reflector
  │  (tarea de fondo)      DRAFT    │  Extrae informe DRAFT
  │                         ──────► │
  ├─ Actualiza archivo de estado    ├─ Presenta DRAFT al usuario
  ├─ Notificación de una línea      ├─ Maneja confirm/revisión/rechazo
  └─ DETENER                        ├─ Escribe reglas al confirmar
                                   └─ Re-reflexiona si se solicita
                                      (carga REFLECT.md)
```

## Servidor MCP de Aristotle

Aristotle incluye un servidor MCP (Model Context Protocol) opcional que añade **control de versiones respaldado por Git** a tus reglas de aprendizaje. Sin él, las reglas son archivos Markdown planos sin historial, sin reversión y sin sincronización entre máquinas. Con él, cada regla obtiene metadatos YAML (frontmatter), seguimiento de estado e historial completo de git.

### ¿Por qué Git?

El archivo plano `aristotle-learnings.md` es solo para agregar. Sin versionado. Si una regla resulta incorrecta, tu única opción es eliminarla manualmente y esperar recordar lo que decía. El servidor MCP soluciona esto:

- **Ciclo de vida del estado** — Las reglas fluyen a través de `pending → staging → verified` (o `rejected`). Nada aterriza en "producción" sin un commit explícito.
- **Lecturas atómicas** — Los consumidores (el futuro Agente L) leen mediante `git show HEAD:`, sin tocar borradores parcialmente escritos en disco.
- **Autocuración** — Si un archivo existe físicamente pero no fue commitado, el sistema detecta la brecha y vuelve a activar el pipeline de commit.
- **Las reglas rechazadas son recuperables** — Los archivos rechazados se mueven a `rejected/{scope}/` con sus metadatos originales intactos, listos para ser restaurados.

### Arquitectura

```
┌──────────────────────────────────────────────────┐
│  OpenCode (Host)                                  │
│                                                   │
│  ┌───────────┐     MCP (stdio)    ┌────────────┐ │
│  │ Aristotle  │ ◄──────────────► │ aristotle   │ │
│  │ Skill      │    JSON-RPC       │ -mcp        │ │
│  └───────────┘                   └──────┬─────┘ │
│                                         │        │
│                              ┌──────────▼──────┐ │
│                              │ Repositorio Git  │ │
│                              │                  │ │
│                              │ user/*.md        │ │
│                              │ projects/H/*.md  │ │
│                              │ rejected/*/      │ │
│                              └──────────────────┘ │
└──────────────────────────────────────────────────┘
```

### Modos de Ejecución: Puente (Bridge) vs. Bloqueante

Aristotle soporta dos rutas de ejecución para la cadena Reflexionar→Verificar (R→C), seleccionadas automáticamente:

```
Ambas rutas son no bloqueantes: la sesión principal nunca se congela.
La diferencia es QUIÉN controla las transiciones de la cadena R→C.
```

| | **Plugin Puente** (recomendado) | **Ruta Bloqueante** (alternativa) |
|---|---|---|
| Activación | Existe el marcador `.bridge-active` | Falta `.bridge-active` |
| Creación de sub-sesión | `promptAsync()` | `task(run_in_background=true)` |
| Controlador de cadena R→C | Manejador de inactividad del Plugin Puente (automático) | LLM de sesión principal (manual) |
| Participación de sesión principal | Cero — lanzar y olvidar | Cada transición requiere llamada al LLM |
| Costo de tokens a sesión principal | Ninguno | Una llamada al LLM por paso de cadena |
| ¿Requiere OMO? | No | No (funciona con o sin OMO) |

```
Ruta puente:  Principal → aristotle_fire_o(R) → DETENER
              Puente → [R hecho] → auto iniciar C → [C hecho] → notifyParent()

Ruta bloqueante: Principal → task(R) → [R hecho, notifica Principal] → LLM de Principal llama MCP → task(C) → [C hecho, notifica Principal] → ...
                         ↑ El LLM de la sesión principal participa en cada paso ↑
```

### Estructura de Almacenamiento

```
~/.config/opencode/aristotle-repo/     ← Repositorio Git (fuente de verdad)
├── .git/
├── .gitignore
├── user/                               ← Reglas globales
│   └── 2026-04-10_hallucination.md
├── projects/                           ← Reglas específicas por proyecto
│   └── a1b2c3d4/                       ← SHA256(ruta_proyecto)[:8]
│       └── 2026-04-12_pattern_violation.md
└── rejected/                           ← Espejo de la estructura anterior
    ├── user/
    └── projects/a1b2c3d4/
```

Cada archivo de regla tiene frontmatter YAML:

```yaml
---
id: "rec_1712743800"
status: "verified"
scope: "user"
category: "HALLUCINATION"
confidence: 0.85
risk_level: "high"

# GEAR intent tags (retrieval dimensions)
intent_tags:
  domain: "database_operations"
  task_goal: "connection_pool_management"
failed_skill: "prisma_client"
error_summary: "P2024 connection pool timeout in serverless"

# Standard fields
source_session: "ses_abc123"
reflection_sequence: 3
created_at: "2026-04-10T22:30:00+08:00"
verified_at: "2026-04-10T22:35:00+08:00"
verified_by: "auto"
---

## [2026-04-10] HALLUCINATION — Fabricated API Method
**Context**: ...
**Rule**: ...
```

### Ciclo de Vida del Estado de las Reglas

```
write_rule()
     │
     ▼
┌──────────┐
│ pending  │  Archivo sin seguimiento en disco
└────┬─────┘
     │ stage_rule()
     ▼
┌──────────┐
│ staging  │  Bloqueado para revisión
└────┬─────┘
   ┌─┴─┐
   │   │
commit   reject_rule()
_rule()      │
   │         ▼
   ▼   ┌──────────┐
verified rejected/  (preserva scope + metadatos)
```

### 25 Herramientas MCP

| Herramienta | Propósito |
|------|---------|
| `init_repo` | Inicializar el repositorio Git, crear estructura de directorios, migrar reglas planas existentes |
| `write_rule` | Crear un nuevo archivo de regla (estado: `pending`) con frontmatter YAML, etiquetas de intención y puntuación de confianza |
| `read_rules` | Consultar reglas por estado, categoría, alcance o regex multidimensional contra el frontmatter |
| `stage_rule` | Marcar una regla como `staging` (en revisión) |
| `commit_rule` | Establecer estado a `verified`, registrar marca de tiempo, `git add && commit` |
| `reject_rule` | Mover a `rejected/{scope}/` con motivo, eliminar original, commit |
| `restore_rule` | Restaurar una regla rechazada al directorio activo con nuevo estado |
| `list_rules` | Listado ligero solo de metadatos con dimensiones de búsqueda completas (sin cargar cuerpos de reglas). Usado para puntuación de relevancia antes de lectura selectiva de contenido |
| `detect_conflicts` | Detectar reglas verificadas que comparten la misma tripleta (domain, task_goal, failed_skill) |
| `check_sync_status` | Detectar reglas verificadas en disco que no están commitadas a git |
| `sync_rules` | Commit de reglas verificadas no sincronizadas a git (detección automática o especificar archivos) |
| `get_audit_decision` | Calcular Δ = confianza × (1 − peso_riesgo) para una regla en staging, devolver nivel de auditoría (auto/semi/manual) |
| `persist_draft` | Persistir un informe DRAFT en disco para revisión y re-reflexión posteriores (escritura atómica en `aristotle-drafts/`) |
| `create_reflection_record` | Añadir un nuevo registro de reflexión al archivo de estado, generar secuencia automática, manejar poda de 50 registros |
| `complete_reflection_record` | Actualizar estado del registro de reflexión después de que el Verificador complete |
| `orchestrate_start` | Inicializar flujo de trabajo para comandos learn/reflect/review/sessions, devolver primera acción |
| `orchestrate_on_event` | Recibir eventos de completado de subagentes, actualizar máquina de estados, devolver siguiente acción |
| `orchestrate_review_action` | Manejar acciones de revisión del usuario (confirm/reject/revise/re_reflect) |
| `on_undo` | Manejar señal de deshacer desde el Plugin Puente — marcar flujo de trabajo como deshecho |
| `report_feedback` | Informar retroalimentación para reglas y opcionalmente activar flujo de trabajo de reflexión |

### Búsqueda de Frontmatter en Fluido (Streaming)

`read_rules` usa una búsqueda de dos fases optimizada para cientos de archivos de regla:

1. **Fase 1 (rápida)** — Lee solo las primeras 50 líneas de cada archivo, hace coincidencia regex de pares clave-valor del frontmatter. Omite archivos que no coinciden. Sin análisis YAML.
2. **Fase 2 (completa)** — Solo para archivos coincidentes, analiza el frontmatter completo y carga el cuerpo Markdown.

Para ~500 archivos, la Fase 1 completa en ~80ms. Búsqueda total con 20 coincidencias: ~180ms.

### Arquitectura de Consulta de Dos Rondas (Fase de Aprendizaje)

La fase de aprendizaje (`/aristotle learn`) usa una consulta eficiente de dos rondas para evitar saturar el contexto de O con contenido de reglas:

```
Ronda 1: list_rules(params) → rutas candidatas + metadatos (sin contenido)
                ↓
Ronda 2: O genera N subagentes de puntuación paralelos
          subagente_i(consulta, ruta_regla) → lee 1 regla → puntúa 1-10 → devuelve {score, reason}
                ↓
O recopila puntuaciones → ordena → toma Top MAX_LEARN_RESULTS (predeterminado: 5)
                ↓
O comprime Top-N en resúmenes mínimos → inyecta en el contexto de L
```

- **O nunca lee el contenido de la regla directamente** — solo orchestra puntuación y compresión
- **Cada subagente tiene contexto mínimo** — una consulta + un archivo de regla
- **La puntuación depende del cuerpo markdown completo** — Las secciones Contexto, Regla y Ejemplo participan todas en la evaluación de relevancia
- **`list_rules` y `read_rules` comparten el mismo motor de búsqueda** — `stream_filter_rules()` — pero devuelven pesos de resultado diferentes

### Prerrequisitos del MCP

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (recomendado) o pip/mamba

> La configuración JSON del MCP se muestra en la sección "Instalación" de nivel superior anterior. Esta sección cubre solo detalles técnicos.

### Configuración

Crea `~/.config/opencode/aristotle-config.json` para personalizar el comportamiento:

```jsonc
{
  // Modo de prompt del Reflector: "full" | "compact" | "auto"
  // "auto" selecciona compact si algún modelo tiene límite de salida ≤ 8192 tokens
  "prompt_mode": "auto"
}
```

Prioridad: var de entorno `ARISTOTLE_PROMPT_MODE` → `aristotle-config.json` → predeterminado `"full"`.

### Migración

Cuando `init_repo` se ejecuta por primera vez, detecta automáticamente archivos existentes de `aristotle-learnings.md` y migra sus reglas al repositorio Git. Predeterminados de migración:

| Campo | Valor | Racional |
|-------|-------|-----------|
| `id` | `mig_N` (secuencial) | Distingue reglas migradas de nuevas |
| `status` | `verified` | Las reglas existentes fueron confirmadas por humanos por naturaleza |
| `confidence` | `0.7` | Predeterminado conservador |
| `risk_level` | Derivado de categoría | `HALLUCINATION` → alto, `SYNTAX_API_ERROR` → medio, otras → bajo |
| `verified_by` | `"migration"` | Marca la fuente |
| `verified_at` | Igual a `created_at` | Analizado desde el encabezado Markdown |

Después de la migración, el archivo original se renombra a `.bak`.

## Protocolo GEAR

Aristotle es una implementación de **[GEAR (Git-backed Error Analysis & Reflection)](./docs/GEAR.md)** — un protocolo para reflexión, aprendizaje y prevención de errores de agentes de IA. En lugar de un archivo plano solo para agregar, las reglas fluyen a través de una máquina de estados con validación de esquema, recuperación impulsada por intención y niveles de auditoría basados en evolución.

**Mapeo Rol GEAR → Aristotle:**

| Rol GEAR | Implementación en Aristotle | Estado |
|-----------|-------------------------|--------|
| **O** (Orquestador) | `SKILL.md` + `REFLECT.md` + `REVIEW.md` + `LEARN.md` | ✅ Activo |
| **R** (Creador de Recursos) | `REFLECTOR.md` (subagente) | ✅ Activo |
| **C** (Verificador) | `REVIEW.md` PASO V2b (validación de esquema) | ✅ Activo |
| **L** (Aprendiz) | `LEARN.md` | ✅ Activo |
| **S** (Buscador) | Función dentro de O (LEARN.md PASO L3) | ✅ Activo |

Las operaciones del protocolo GEAR se mapean a las herramientas MCP de Aristotle: `produce` → `write_rule`, `stage` → `stage_rule`, `verify` → `commit_rule`, `reject` → `reject_rule`, `restore` → `restore_rule`, `search` → `read_rules`, `sync` → `check_sync_status` + `sync_rules`, `audit_decision` → `get_audit_decision`.

La especificación completa del protocolo — máquina de estados, esquema de frontmatter, factor de decisión Δ y requisitos de conformidad — está documentada en **[GEAR.md](./docs/GEAR.md)**.

## Pruebas

> **Documentación completa de pruebas:** Consulta **[TESTING.md](./docs/testing.md)** para suites detalladas de pruebas, desgloses de cobertura y planes de pruebas manuales.

| Suite | Comando | Cantidad |
|-------|---------|-------|
| Estática | `bash scripts/test.sh` | 103 |
| Unitarias/Integración (Python — MCP + Intervención) | `uv run pytest tests/ intervention/tests/ -v` | 986 |
| Paquete Watchdog (TypeScript) | `cd packages/watchdog && bunx vitest run` | 1262 |
| Paquete Core (TypeScript) | `cd packages/core && bunx vitest run` | 150 |
| Paquete Aristotle (TypeScript) | `cd packages/reflection && bunx vitest run` | 115 |
| Puente Legacy (archivado) (TypeScript) | `cd plugins/aristotle-bridge && bunx vitest run` | 162 |
| Integración E2E | `uv run pytest tests/test_e2e_bridge_integration.py -v` | 9 |
| Regresión (verificación de despliegue) | `bash tests/regression/regression_b1_checks.sh` | 64 |

### Historial de Cobertura de Pruebas

> Fase 2 completa. Consulta **[TESTING.md](./docs/testing.md)** para documentación detallada de pruebas.

| Hito | pytest | estática | vitest | e2e |
|-----------|--------|--------|--------|-----|
| Línea base (pre-remediación) | 111 | 67 | — | — |
| Post-remediación | 134 | 67 | — | — |
| Post-fusión coroutine-O | 166 | 84 | — | — |
| Orquestación GEAR (M1-M4) | 218 | 98 | — | — |
| Pruebas de ruta de excepción M4 | 227 | 98 | — | — |
| **Fase 2 (M1/M5-M9)** | **295** | **104** | — | **70** |
| Puente Fase 0 (ext MCP) | 318 | 103 | — | 9 |
| Puente Fase 1 (Plugin) | 325 | 103 | — | 9 + 162 vitest |
| **v1.2.0 UX de Revisión** | **382** | **103** | — | **9 + 162 vitest** |
| **v1.3.0 Aislamiento por Registro** | **395** | **103** | — | **80 pytest + 162 vitest** |
| **Extracción Core Fase 0** | **405** | **103** | **150 core + 115 aristotle** | **9 + 162 bridge + 64 regresión** |
| **Puente Watchdog-Intervention** | **986** | **103** | **1262 watchdog + 150 core + 115 aristotle + 162 bridge** | **9 + 64 regresión** |

## Estructura del Proyecto

```
.
├── skill/                 # Documentos de la habilidad (copiados a los dirs de instalación por install.sh)
│   ├── SKILL.md           # Enrutador — análisis de argumentos, enrutamiento de fase (5.6 KB)
│   ├── REFLECTOR.md       # Protocolo de subagente — análisis de errores, generación de DRAFT
│   ├── REFLECT.md         # Fase de reflexión del coordinador — lanza subagente, seguimiento de estado, disparo pasivo
│   ├── REVIEW.md          # Fase de revisión del coordinador — revisión de DRAFT, escritura de reglas, revisión
│   ├── CHECKER.md         # Protocolo del verificador — validación de esquema + contenido (cargado solo al confirmar)
│   └── LEARN.md           # Fase de aprendizaje del coordinador — extracción de intención, construcción de consulta, filtrado de resultados
├── scripts/
│   ├── install.sh             # Instalador (macOS/Linux)
│   ├── install.ps1           # Instalador (Windows)
│   ├── test.sh               # Suite de pruebas estáticas (103 aserciones)
│   ├── reset-runtime.sh      # Restablecer estado de tiempo de ejecución
│   └── uninstall.sh          # Script de desinstalación
├── pyproject.toml        # Dependencias de Python para el servidor MCP
├── aristotle_mcp/        # Servidor MCP (gestión de reglas respaldada por Git + orquestación de flujo de trabajo)
│   ├── __init__.py
│   ├── config.py         # Rutas, constantes, vars de entorno, PESOS_DE_RIESGO, UMBRALES_DE_AUDITORÍA, DIR_DE_HABILIDAD
│   ├── models.py         # Dataclass RuleMetadata, serialización YAML
│   ├── git_ops.py        # Abstracción de Git (init, add+commit, show, log, status, show_exists)
│   ├── frontmatter.py    # Búsqueda de frontmatter en fluido, escrituras atómicas
│   ├── evolution.py      # Motor de decisión Δ (compute_delta, decide_audit_level)
│   ├── migration.py      # Migración de Markdown plano → repositorio Git
│   ├── server.py         # Punto de entrada FastMCP, reexportaciones, registro de herramientas
│   ├── _utils.py         # Funciones de utilidad compartidas
│   ├── _tools_rules.py   # 10 herramientas del ciclo de vida de reglas (incluye detect_conflicts, get_audit_decision)
│   ├── _tools_sync.py    # 2 herramientas de sincronización
│   ├── _tools_reflection.py  # 3 herramientas de estado de reflexión
│   ├── _tools_undo.py    # Herramienta on_undo (señalización de deshacer del puente)
│   ├── _tools_feedback.py    # Herramienta report_feedback (retroalimentación de reglas + auto-reflexión)
│   ├── _orch_prompts.py  # Plantillas + constructores de prompts
│   ├── _orch_state.py    # Persistencia de flujo de trabajo + gestión de estado
│   ├── _orch_parsers.py  # Analizadores + formateadores
│   ├── _orch_start.py    # Herramienta orchestrate_start (session_file + use_bridge)
│   ├── _orch_event.py    # Herramienta orchestrate_on_event
│   └── _orch_review.py   # Herramienta orchestrate_review_action
│   ├── _intervention_bridge.py   # Puente de subproceso de intervención TS→Python
│   └── tests/              # Pruebas unitarias del servidor MCP
├── intervention/           # Sistema de Intervención Watchdog v1.6.0 (581 pruebas)
│   ├── src/
│   │   ├── intervention_coordinator.py  # Hub central: intervenir(), lote, evaluación, despacho de señales
│   │   ├── intervention_types.py        # Datclasses, PRIORIDAD_DE_VIOLACIÓN, ContextoDePipeline
│   │   ├── handlers.py                  # 12 manejadores de tipos de violación (skip_red_phase, modified_test, etc.)
│   │   ├── signal_mapper.py             # 21 señales de detección → mapeo de tipo de violación
│   │   ├── priority_pipeline.py         # Procesamiento de violaciones ordenado por prioridad + eliminación de validez
│   │   ├── special_handler.py           # ARCHIVO_REQUIERE_DIVISIÓN, INYECCIÓN_DE_PROMPT_BLOQUEADA, CICLO_DE_PATRÓN
│   │   ├── compliance.py                # Auto-commit, ciclo de vida de doc KI, evaluación, CommitGuard
│   │   ├── compliance_batch.py          # Procesamiento por lotes de cumplimiento con lógica de cortocircuito
│   │   ├── quarantine_engine.py         # Cuarentena a nivel de archivo con metadatos respaldados por git
│   │   ├── ki_doc_manager.py            # CRUD de documentos KI + cálculo de evaluación
│   │   ├── rollback_engine.py           # Reversión basada en Git
│   │   ├── commit_guard.py              # Auto-commit por fase/bucle con seguimiento de fallos
│   │   ├── committer.py                 # Validación de esquema de frontmatter
│   │   ├── prompt_validator.py          # Detección bilingüe de patrones prohibidos (FP-1..FP-7)
│   │   ├── rule_generator.py            # Plantillas de instrucciones específicas por tipo de violación
│   │   ├── rps_scanner.py               # Escáner de Prompts de Revisión — 12 patrones prohibidos
│   │   ├── gpav_validator.py            # Validación de envío GPAV (5 pasos ordenados)
│   │   ├── proposal_recorder.py         # Registro de propuestas GPAV + análisis de ubicación
│   │   ├── regression_counter.py        # Seguimiento de regresión por pipeline
│   │   ├── pattern_cycle_detector.py    # Detección de ciclo por ventana deslizante (3-en-10)
│   │   ├── main_agent_tracker.py        # Seguimiento de fallos consecutivos del agente principal
│   │   ├── pending_subagent_tracker.py  # Ciclo de vida de subagentes pendientes (generado/terminado/fallido)
│   │   ├── subagent_retry_handler.py    # Cadena de reintento (1+3) + cascada de degradación
│   │   ├── checkpoint_bounded_counter.py # Contador acotado para violaciones dispersas
│   │   ├── watchdog.py                  # Filtro de Violación (comprobaciones conductuales Fase 4-5)
│   │   └── reflector.py                 # Stub de auto-reflexión
│   ├── tests/                           # 574 casos pytest
│   └── docs/                            # Requisitos, planes de prueba, documentos KI
├── packages/
│   ├── core/              # Biblioteca Core — mecanismo compartido (registrador, configuración, almacén de flujo, ejecutor, registro de plugins)
│   │   ├── src/           # 10 módulos
│   │   └── test/          # 150 casos vitest
│   ├── aristotle/         # Rol Aristotle — manejador de inactividad, herramientas, extractor de instantáneas, configuración
│   │   ├── src/           # 6 módulos
│   │   └── test/          # 115 casos vitest
│   └── watchdog/          # Puente Watchdog-Intervention (TypeScript) — aplicación de pipeline TDD
│       ├── src/           # 42 módulos: almacén de pipeline, punto de control, interceptor, observador, revisor, doble paso
│       │   └── intervention-bridge.ts   # Puente de subproceso al motor de intervención Python
│       └── test/          # 72 archivos de prueba, 1258 casos vitest
├── plugin/
│   ├── index.ts           # Entrada del plugin — assemblePlugin + createAristotleRole
│   └── dist/              # Salida compilada (desplegada en la ruta de plugin de opencode)
├── plugins/
│   └── aristotle-bridge/  # Plugin Puente Legacy — archivado (reflexión asíncrona antigua por sondeo)
│       ├── src/           # 9 módulos (estructura antigua)
│       ├── test/          # 8 archivos de prueba, 162 casos vitest (archivado)
│       ├── testing.en.md  # Documentación de pruebas específica del puente (Inglés)
│       └── testing.zh.md  # Documentación de pruebas específica del puente (Chino)
├── Dockerfile             # Imagen de contenedor sin estado (opencode + runtime Python/uv/bun)
├── docker-compose.yml     # Montajes enlazados de config/datos del host para ejecución sin estado
├── tests/
│   ├── e2e/
│   │   ├── e2e_opencode.sh          # Script de automatización E2E (14 aserciones)
│   │   └── ...
│   ├── regression/
│   │   └── regression_b1_checks.sh  # Verificación de despliegue (64 aserciones)
│   └── test_e2e_bridge_integration.py  # Integración Puente↔MCP (9 pytest)
└── intervention/                        # (detalle arriba)
```

## Arquitectura: Revelación Progresiva

La habilidad se divide en seis archivos. Solo `SKILL.md` (5.6 KB) se carga al activarse. Los demás archivos se cargan bajo demanda:

| Escenario | Archivos Cargados | Tamaño |
|----------|-------------|------|
| `/aristotle` (reflexionar) | SKILL.md + REFLECT.md | 10.0 KB |
| `/aristotle sessions` | Solo SKILL.md | 5.6 KB |
| `/aristotle review N` | SKILL.md + REVIEW.md | 12.2 KB |
| `/aristotle review N` (confirmar) | SKILL.md + REVIEW.md + CHECKER.md | 20.9 KB |
| `/aristotle learn` | SKILL.md + LEARN.md | 14.4 KB |
| Revisión + re-reflexión | SKILL.md + REVIEW.md + REFLECT.md | 16.7 KB |
| Subagente (interno) | REFLECTOR.md | 10.2 KB |

## Problemas Conocidos y Contribuciones

¡Las PRs son bienvenidas! Estas son áreas que necesitan mejora:

### Prioridad Media

- **Análisis de parámetros de comando** — `last`, `session ses_xxx`, `recent N` y `--focus <hint>` están documentados pero aún no implementados. Actualmente `/aristotle` siempre reflexiona sobre la sesión actual con `focus: "last"`. Consulta `design_plan/pending-params-implementation.md` para el plan de implementación.
- **Configuración de modelo del Reflector** — El Reflector actualmente usa el modelo predeterminado del host. Añadir una opción de configuración `reflector_model` en `aristotle-config.json` (con la misma cadena de prioridad que `prompt_mode`) permitiría a los usuarios optimizar por costo o calidad.
- **Acceso `session_read` del subagente** — El subagente Reflector anteriormente requería `session_read()` para leer el contenido de la sesión, lo cual algunas combinaciones de modelo/proveedor no exponen. **Mitigado por Plugin Puente**: el extractor de instantáneas PRE-RESOLVE captura el contexto de error en la sesión principal (que tiene acceso) y lo pasa al Reflector mediante `session_file`. La degradación elegante completa (caída a `session_list` + `session_info`) sigue siendo deseable para rutas no puente.
- **Sistemas de tipos duales del módulo de intervención** — `compliance.py` y `intervention_types.py` definen jerarquías de tipos paralelas (ViolationEvent, InterventionResult, KiDocManager, VIOLATION_PRIORITY) que deberían consolidarse en una única fuente canónica. Actualmente aisladas funcionalmente pero crean carga de mantenimiento. Consulta los hallazgos de auditoría 7B-1 a 7B-9 de la Fase 7.

### Deseable (Nice to Have)

- ~~**Versionado y caducidad de reglas**~~ — Resuelto por el servidor MCP (respaldado por Git). Las reglas ahora tienen historial completo de commits y pueden ser rechazadas/restauradas. La caducidad/poda sigue siendo deseable.
- **Pruebas multiplataforma de `count_matches`** — El helper `count_matches` de la suite de pruebas funciona con GNU grep, pero debería probarse en Alpine (BusyBox), macOS (BSD grep) y otros entornos no GNU.

## Restablecer / Limpiar Datos

Si deseas limpiar todos los datos de Aristotle sin desinstalar, consulta [RESET.md](./docs/reset.md).

## Desinstalar

```bash
# Elimina la habilidad
rm -rf ~/.config/opencode/skills/aristotle

# Elimina el servidor MCP
rm -rf ~/.config/opencode/aristotle

# Elimina el Plugin Puente (opcional)
rm -rf ~/.config/opencode/aristotle-bridge

# Elimina aprendizajes de nivel de usuario (opcional)
rm -f ~/.config/opencode/aristotle-learnings.md
rm -f ~/.config/opencode/aristotle-learnings.md.bak

# Elimina archivo de estado (opcional)
rm -f ~/.config/opencode/aristotle-state.json

# Elimina repositorio de reglas MCP (opcional)
rm -rf ~/.config/opencode/aristotle-repo

# Elimina configuración MCP de opencode.json (edición manual)
# Elimina la entrada "aristotle" de la sección "mcp"
```

## Licencia

MIT
