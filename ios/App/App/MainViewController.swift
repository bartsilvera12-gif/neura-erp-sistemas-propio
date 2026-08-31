import UIKit
import Capacitor

/**
 * Controlador raíz del WebView.
 *
 * Existe sólo para habilitar el gesto de deslizar desde el borde izquierdo para
 * volver atrás, que es lo que un usuario de iOS espera de cualquier app. Capacitor
 * no lo expone en capacitor.config (no hay ninguna opción `ios.*` para esto), así
 * que hay que tocarlo en el WKWebView directamente.
 *
 * `capacitorDidLoad()` es el punto de extensión que da Capacitor: corre después de
 * que el bridge creó el WebView, que es cuando la propiedad existe.
 */
class MainViewController: CAPBridgeViewController {

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // Deslizar desde el borde izquierdo = atrás; desde el derecho = adelante.
        // Funciona con el historial de pushState del router de Next.
        webView?.allowsBackForwardNavigationGestures = true
    }
}
