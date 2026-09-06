---
name: fmway-pr
version: 1.0.0
description: La única skill de este paquete que ejecuta `git add`, `git commit`, `git push` o `gh pr create`. Invocar SOLO cuando el usuario pide explícitamente commitear, pushear o abrir/preparar un PR (por ejemplo "commiteá esto", "guardá el avance", "pusheá la rama", "preparame el PR", "abrí el PR"). Ninguna otra skill fmway puede invocarla automáticamente ni ejecutar esos comandos de git por su cuenta — solo pueden sugerírsela al usuario.
---

# Preparar PR / commitear cambios

El único lugar donde el trabajo de fmway se persiste en git. Todos los demás flujos de este paquete
solo **escriben archivos** y **sugieren** correr esta skill en los checkpoints naturales; ninguno
commitea, pushea ni abre un PR por su cuenta. La lista de esos flujos no se enumera acá a propósito:
cualquier flujo fmway, actual o futuro, sigue la misma regla, así que no hay nada que mantener
sincronizado cuando se agrega, se renombra o se elimina una skill.

**El verdadero freno contra la auto-invocación es la `description` del frontmatter de arriba**, no
este párrafo: el matcheo de skills ocurre sobre esa descripción antes de leer el cuerpo, así que el
"Invocar SOLO cuando el usuario pide explícitamente" tiene que vivir ahí para funcionar de verdad.
Este cuerpo es la segunda línea de defensa para quien termine leyendo el archivo directamente: si sos
una skill que llama, no invoques esta skill vos — decí algo como *"Este checkpoint está listo. Corré
`fmway-pr` (o pedímelo) cuando quieras commitearlo."* y frená ahí.

---

## Paso 1 — Ubicar el contexto

```bash
git branch --show-current
```

Derivá el `{slug}` igual que los flujos (la rama sin su prefijo `feat/` | `fix/` | `fix/security-` |
`chore/` | `docs/` | `assess/` | `po/`). Si existe `.ways/state.json`, leelo (todavía no lo escribas)
para saber el `flow`, la `phase` y a qué gate o documento corresponde este checkpoint. Si no existe
(flujos de evaluación o documentación sin archivo de ítem, o un pedido suelto de "commiteá esto"),
seguí sin él.

## Paso 2 — Mostrar exactamente qué se commitearía

```bash
git status --short && git diff --stat && git diff --stat --staged
```

Presentale esto al usuario antes de tocar nada. Si no hay nada staged ni modificado, decilo y frená:
no hay nada para commitear.

## Paso 3 — Proponer un mensaje de commit

No inventes un mensaje genérico: el `SKILL.md` del flujo que llama ya documenta el formato exacto del
mensaje para su fase (buscá la sección "formato del mensaje de commit" cerca del checkpoint en el que
está el usuario, o inferí el tipo desde el prefijo de la rama: `feat/` → `feat({slug}): …`, `fix/` →
`fix({slug}): …`, `fix/security-` → `fix(security): …`, `chore/` → `chore(…)`, `docs/` →
`docs({slug}): …`, `assess/` → `assess({slug}): …`). Si no hay convención evidente, preguntale al
usuario.

Si el archivo de estado `.ways/state.json` cambió junto con otros archivos, se commitea **junto con**
ellos en el mismo commit — nunca en un commit separado y no anunciado.

Si hay más de una unidad lógica de trabajo staged o modificada (por ejemplo, dos checkpoints sin
relación), decilo y preguntá si conviene partirla en commits separados, en lugar de empaquetarla en
silencio.

### Gate — confirmación del commit

Decí: **"Voy a commitear: {lista de archivos}. Mensaje: `{mensaje propuesto}`. Confirmame antes de
que corra `git add` / `git commit`."**

**Frená. No ejecutes `git add` ni `git commit` hasta que el usuario confirme.**

Recién después de la confirmación explícita, stageá exactamente los archivos revisados y commiteá.

## Paso 4 — Push y PR (solo si el usuario también lo pide)

No asumas que un commit implica que el usuario también quiere pushear o abrir un PR. Preguntá:

> ¿Querés que además pushee `{rama}` y abra un PR a `{base}`?

Si dice que sí, redactá el título y el cuerpo con la misma plantilla que ya define el flujo que llama
para su fase de PR (resumen, links a los documentos relevantes, checklist de validación — mirá el
`SKILL.md` de ese flujo). Mostrale el título y el cuerpo redactados al usuario.

### Gate — confirmación de push y PR

Decí: **"Voy a pushear `{rama}` y abrir un PR: `{base}` ← `{rama}`, título `{título}`. Confirmame
antes de que pushee y lo abra."**

**Frená. No ejecutes `git push` ni `gh pr create` hasta que el usuario confirme.**

Recién después de la confirmación explícita:

```bash
git push -u origin {rama}
```

```bash
gh pr create --base {base} --head {rama} --title "{título}" --body "{cuerpo}"
```

Compartile la URL del PR resultante al usuario.

## Paso 5 — Actualizar el estado (si existe archivo de estado)

Si existe `.ways/state.json` y se acaba de abrir un PR, poné la `url` del `gates[]` correspondiente
con el link del PR, como parte del trabajo ya confirmado en el Paso 4 — es metadata de la acción
recién realizada, no una acción nueva sin anunciar, así que no necesita su propio gate. Si el gate de
PR ahora corresponde que quede en `passed` (por ejemplo, se mergeó por fuera y el usuario solo lo está
registrando acá), actualizá también su `status`.

---

## Qué NO hacer

- No te auto-invoques desde el flujo de otra skill: solo corrés cuando el usuario lo pide
  explícitamente en el turno actual.
- No commitees, pushees ni abras un PR sin pasar por los gates de confirmación de arriba, incluso si
  el usuario te invocó directamente — invocar esta skill inicia la conversación, no es en sí mismo la
  confirmación.
- No metas cambios sin relación en un mismo commit sin avisarlo antes.
- No mergees PRs. Abrir un PR está en alcance; mergear es siempre una acción explícita y separada del
  usuario, fuera de esta skill.
