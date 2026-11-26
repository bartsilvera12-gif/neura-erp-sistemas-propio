# Plan — Solicitudes de compra con flujo por roles e ingreso a inventario

> Entregable de planificación. **No implementar ni commitear sin autorización.**
> Fecha: 2026-11-26 · Módulo: Compras + Inventario (schema `neura`).

## Objetivo

Que **comercial** (Fernando, Patricio) pueda armar un **pedido / solicitud de compra**
de forma cómoda, que **Alan** lo **confirme o modifique** según lo que se pueda
conseguir, que **Guillermo** **confirme el pago**, y que la mercadería **ingrese al
stock** correctamente para que comercial después pueda **venderla** — dejando el
inventario perfectamente trazado (entra por recepción, sale por venta).

## La base: el 80% ya existe

El flujo técnico de compras ya está construido y **se reutiliza tal cual**:

| Pieza existente | Tabla / pantalla | Rol en este flujo |
|---|---|---|
| Orden de compra (cabecera + ítems) | `neura.ordenes_compra`, `neura.orden_compra_items` · [compras/ordenes](../../src/app/compras/ordenes/page.tsx) | Es el "pedido" en sí; ya tiene estados y aprobación (`aprobada_by`) |
| Recepción | `neura.recepciones` · [compras/recepciones](../../src/app/compras/recepciones/page.tsx) | **Ingresa el stock** (genera `movimiento_inventario` tipo `recepcion`) |
| Compra + cuotas | `neura.compras`, cuotas (mig. `20260721140000`) | Documento fiscal y registro del **pago** |
| Movimientos de inventario | `neura.movimientos_inventario` | Entrada (recepción) y salida (venta) |
| Productos | `neura.productos` · [inventario/nuevo](../../src/app/inventario/nuevo/page.tsx) | Catálogo; cada línea de la solicitud apunta a uno real |
| Ventas | `neura.ventas` (mig. `20260517100000`) | Descuenta stock al vender |

Estados actuales de `ordenes_compra`: `borrador → aprobada → parcialmente_recibida
→ recibida → cerrada / cancelada`, con `aprobada_by/at`.

## Lo que hay que agregar (la "capa de flujo")

1. Un estado inicial **`solicitada`** (lo crea comercial) antes de `aprobada`.
2. Un **gate de pago** independiente (`pago_estado`) que confirma Guillermo.
3. **Ruteo por rol** (quién crea / confirma / paga) + **bandejas** por rol.
4. **Notificaciones** en la campanita en cada handoff (reusa `usuario_notificaciones`).
5. En la solicitud, **selector de producto de inventario** con **"＋ Crear producto"**
   inline (queda **listo para usar**, con stock 0).

### Decisión de diseño: extender `ordenes_compra` (no tabla nueva)

Se reutiliza `ordenes_compra` como "solicitud" para no duplicar ítems/proveedor/
totales/aprobación. El `estado` nuevo `solicitada` es el borrador de comercial;
al confirmarlo Alan pasa a `aprobada` (ya firme). El pago es una columna aparte
porque es **ortogonal** a la recepción.

---

## Fases

### Fase 0 — Migración (DB)

Un solo archivo `supabase/migrations/<ts>_solicitudes_compra_flujo.sql`,
idempotente, **solo schema `neura`**.

- `ordenes_compra.estado`: ampliar el CHECK para incluir **`solicitada`** (nuevo
  primer estado). *(Ampliar un CHECK en prod puede requerir `SET ROLE
  supabase_admin` al aplicar — ver memoria de migraciones de notificaciones.)*
- Columnas nuevas en `ordenes_compra`:
  - `solicitada_by uuid`, `solicitada_at timestamptz` (quién/cuándo la pidió).
  - `pago_estado text DEFAULT 'pendiente' CHECK (pago_estado IN ('pendiente','confirmado'))`.
  - `pago_confirmado_by uuid`, `pago_confirmado_at timestamptz`,
    `pago_metodo text`, `pago_referencia text`.
  - `rechazada_by/at`, `motivo_rechazo text` (Alan rechaza una solicitud).
- `productos`: ningún cambio de columnas. (El producto creado por comercial nace
  normal, **listo para usar**, stock 0.)
- Permisos: GRANT a `authenticated`/`service_role`, RLS por `puede_acceder_empresa`
  (mismo patrón que el resto de `neura`), y **`NOTIFY pgrst, 'reload schema'`** al
  final (sin esto la API da 400 "could not find column").
- Config de roles: ver Fase 5 (se puede hacer con una tabla de permisos o flags).

**DoD:** la migración aplica en limpio, `ordenes_compra` acepta `solicitada` y
`pago_estado`, y PostgREST ve las columnas nuevas.

### Fase 1 — Solicitud de compra (comercial)

- Pantalla **"Nueva solicitud"** (versión simplificada de "nueva orden"):
  proveedor (Fastrax por defecto), fecha deseada, y **líneas de producto**.
- **Campo de producto = buscador de inventario** (el buscador inteligente:
  unaccent + pg_trgm, tildes/orden libre/typos). Siempre "estira" productos del
  catálogo.
- Si no existe, botón **"＋ Crear producto"** inline → crea el `producto` real
  (nombre, categoría, unidad, código, costo/precio ref.), **stock 0**, y queda
  seleccionado. `orden_compra_items.producto_id` **nunca** queda en texto suelto.
- Al guardar: `estado = 'solicitada'`, `solicitada_by = usuario`.
- API: `POST /api/compras/solicitudes` (crea orden `solicitada` + ítems) y el
  endpoint de crear producto inline (reusa el de inventario).

**DoD:** comercial crea una solicitud con N productos (algunos nuevos) y queda en
estado `solicitada`.

### Fase 2 — Confirmación (Alan)

- Bandeja **"Solicitudes por confirmar"** (filtra `estado='solicitada'`).
- Alan puede: **editar cantidades/costos, quitar líneas** que no se consiguen, y
  **Aprobar** (→ `estado='aprobada'`, `aprobada_by`) o **Rechazar** (→ estado
  `cancelada`/`rechazada` + motivo).
- Notifica al pagador (Guillermo) cuando queda `aprobada`, y al comercial si se
  rechaza o se modifica.

**DoD:** Alan ajusta y aprueba; la orden pasa a `aprobada` y Guillermo recibe aviso.

### Fase 3 — Pago (Guillermo)

- Bandeja **"Órdenes por pagar"** (filtra `estado='aprobada'` y
  `pago_estado='pendiente'`).
- Acción **"Confirmar pago"**: setea `pago_estado='confirmado'`,
  `pago_confirmado_by/at`, y opcionalmente `pago_metodo`/`pago_referencia`.
  - *Simple:* solo marca "pagado".
  - *Completo (opcional):* además registra la **Compra** + **cuota** (reusa lo
    existente) para que impacte en contabilidad.
- Notifica a depósito/Alan que está lista para recibir (según decisión de orden,
  ver abajo).

**DoD:** Guillermo confirma el pago; la orden queda `pago_estado='confirmado'`.

### Fase 4 — Recepción → ingresa al stock

- Se reutiliza **Recepción** tal cual: al confirmar la recepción contra la orden,
  se genera el `movimiento_inventario` tipo `recepcion` y **el stock entra** sobre
  el `producto_id` de cada línea. La orden pasa a `recibida`
  (o `parcialmente_recibida`).
- Solo se suma el **gate** según la decisión pendiente (¿exigir
  `pago_estado='confirmado'` antes de permitir recibir?).

**DoD:** tras la recepción, los productos muestran stock disponible en inventario.

### Fase 5 — Roles, bandejas y notificaciones

- **Roles del flujo** (configurable): quién es *comercial* (crea), quién
  *confirma* (Alan), quién *paga* (Guillermo), quién *recibe* (depósito).
  - Opción simple: flags/permiso por usuario (`compras_solicita`,
    `compras_confirma`, `compras_paga`) o una tabla `compras_roles`.
- **Bandejas por rol** (estilo tickets de Soporte): "Mis solicitudes",
  "Por confirmar", "Por pagar", "Por recibir".
- **Notificaciones** en la campanita en cada handoff (reusa `usuario_notificaciones`
  + push), con sonido (regla del módulo de notificaciones).
- **Ayuda contextual** ("?"): enlazar un artículo de Ayuda en línea con el flujo.

**DoD:** cada rol ve solo su bandeja y recibe aviso cuando le toca actuar.

---

## Flujo resultante

`Solicitud (comercial)` → `Confirmar (Alan)` → `Pago (Guillermo)` →
`Recepción (+stock)` → `Venta (−stock)`.

Puntos que tocan inventario: **Recepción** (entra) y **Venta** (sale).

## Decisiones pendientes

1. **Orden del pago vs. recepción.** ¿Fastrax cobra por adelantado (pago antes de
   recibir) o contra entrega (recibir y luego pagar)? → define si la Fase 4 exige
   `pago_estado='confirmado'`. *Recomendado:* hacerlo **configurable por empresa**
   (switch "requiere pago antes de recibir"), default **off**.
2. **Alcance del pago de Guillermo.** ¿Solo marca "pagado" (simple) o además
   registra Compra + cuota para contabilidad (completo)? *Recomendado:* arrancar
   simple en Fase 3 y sumar el registro contable después.
3. **Roles.** ¿Flags por usuario o una pantalla de configuración de roles de
   compras? *Recomendado:* flags para arrancar; config si se complejiza.

## Riesgos / cuidados

- Ampliar el CHECK de `estado` en prod: aplicar con `SET ROLE supabase_admin`.
- Tras agregar columnas: `NOTIFY pgrst, 'reload schema'` o la API da 400.
- Crear productos desde comercial: el buscador debe priorizar coincidencias
  existentes para no duplicar el catálogo (el usuario pidió que igual nazcan
  **listos para usar**, sin estado de revisión).
- No tocar movimientos/compras históricos; todo idempotente y solo en `neura`.

## Estimación gruesa (orden de magnitud)

- Fase 0: 0.5 día · Fase 1: 1–1.5 días · Fase 2: 1 día · Fase 3: 0.5–1 día ·
  Fase 4: 0.5 día (reuso) · Fase 5: 1–1.5 días.
- Se puede entregar **incremental**: con Fases 0–2 ya hay solicitud + confirmación
  usables; pago y bandejas suman después.
