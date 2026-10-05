# Android (APK del asesor) — contexto para trabajar

Guía para quien tome el trabajo de Android. Lo primero y más importante:

> **La APK no contiene la app.** Es un contenedor que abre
> `https://sistemas.neura.com.py/m/asesor` en un WebView. Todo lo que se ve adentro —el chat,
> la lista, los botones— es Next.js que vive en el servidor y se despliega aparte.

De ahí sale casi todo lo demás: si hay que cambiar algo que se ve, **no se toca Android**.

---

## 1. El repo

```
git clone https://github.com/bartsilvera12-gif/neura-erp-sistemas-propio.git
```

Rama de trabajo: `main`. **Pushear a `main` despliega el ERP a producción** (Coolify, 8 a
14 minutos). No es una rama de integración: lo que entra, sale a los usuarios.

Lo de Android vive en `android/` (66 archivos versionados) y la configuración del contenedor
en `capacitor.config.ts`, en la raíz.

---

## 2. Qué es cada cosa

| Ruta | Qué es |
|---|---|
| `capacitor.config.ts` | Identidad de la app y a qué URL apunta el WebView |
| `android/` | Proyecto Android generado por Capacitor |
| `android/app/src/main/java/py/com/neura/erp/MainActivity.java` | La única clase propia; hoy casi vacía |
| `src/app/m/asesor/**` | **La app que el asesor ve.** Next.js, no Android |
| `src/app/api/mobile/asesor/**` | Las APIs que consume esa vista |
| `docs/CAPACITOR_PUSH_SETUP.md` | Guía original del armado y del push |

Datos de la app: `applicationId` **py.com.neura.erp**, nombre "Zentra ERP", `minSdk` 23,
`compileSdk` 35, `versionCode` 1.

---

## 3. Lo que falta para compilar

**`android/app/google-services.json` no está en el repo** (está en `.gitignore`, a propósito:
es configuración de Firebase y no se commitea).

Hay que bajarlo de la consola de Firebase, proyecto **neura-erp-contact-center**, app Android
**py.com.neura.erp**, y ponerlo en `android/app/`. Sin ese archivo el build falla o compila sin
notificaciones push, que es lo único que la APK realmente aporta sobre abrir el sitio en el
navegador.

Después, lo de siempre: JDK 17+, Android Studio o las herramientas de línea de comandos, y

```bash
cd android && ./gradlew assembleDebug
```

El APK sale en `android/app/build/outputs/apk/debug/`.

---

## 4. Qué NO tocar

### `capacitor.config.ts`

- **`appId: "py.com.neura.erp"`** — está atado a Firebase, a los perfiles de firma de iOS y a
  los tokens de push ya registrados. Cambiarlo rompe las notificaciones de todos los que ya
  tienen la app instalada, y no hay vuelta atrás sin volver a registrarlos uno por uno.
- **`server.url`** — es lo que hace que la app muestre el ERP. Apuntarlo a otro lado deja la
  app en blanco.
- **`allowNavigation`** — la lista de dominios permitidos. Sacar uno corta la carga de
  imágenes o la autenticación.

### El ERP

`src/app/m/asesor/**` y `src/app/api/**` son la app web. Se pueden tocar, pero eso **no es
trabajo de Android**: cualquier cambio ahí sale a producción al pushear y afecta también al
escritorio y a la app de iOS. Si el pedido es "cambiar algo de la pantalla del asesor", el
cambio va ahí y no necesita APK nueva.

### Los archivos generados de Capacitor

`android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle` y
`android/app/src/main/assets/capacitor.plugins.json` los reescribe `npx cap sync`. Editarlos a
mano se pierde en la siguiente sincronización.

### Lo que no está versionado

`google-services.json` y los `.env`. No commitear ninguno de los dos aunque Git los muestre.

---

## 5. Cómo trabajar sin romper nada

1. **Antes de tocar Android, preguntarse si el cambio es del WebView.** Nueve de cada diez
   pedidos ("que el chat muestre X", "que el botón diga Y") se resuelven en `src/app/m/asesor`
   y no requieren compilar nada.
2. Android se toca sólo para: permisos, íconos, splash, el canal de notificaciones, la versión
   de la app, plugins nativos nuevos y el empaquetado.
3. Después de agregar o actualizar un plugin de Capacitor: `npx cap sync android`.
4. Para probar, alcanza con `assembleDebug` e instalar por USB. El APK firmado para repartir es
   otro tema y hoy no está configurado: no hay keystore de release en el repo.

---

## 6. Dos cosas que conviene saber de entrada

**Las notificaciones push ya funcionan del lado del servidor.** El backend manda los avisos por
Firebase y guarda los tokens; eso está en producción y no hay que tocarlo. Lo que falta es del
lado del teléfono: que la APK registre el token y que al tocar el aviso abra el chat. El
payload trae `data.route` con `/m/asesor/chat/<id>`, que es lo que hay que usar para navegar.

**Hay una segunda app iOS que no es ésta.** "Zentra Dev" (`py.com.neura.erp.dev`) es una app
nativa SwiftUI, en otro repositorio, de uso interno. No comparte código con la APK más allá de
consumir las mismas APIs. Si alguien habla de "la app", conviene aclarar cuál.
