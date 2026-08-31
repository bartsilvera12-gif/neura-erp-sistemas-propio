import UIKit
import Capacitor

/**
 * Ciclo de vida basado en UIScene (obligatorio desde iOS 27).
 *
 * Hasta iOS 26 la app arrancaba con el patrón viejo: AppDelegate creaba la UIWindow
 * y UIKit levantaba Main.storyboard vía UIMainStoryboardFile. En iOS 27 UIKit evalúa
 * la adopción de escenas al crear la primera scene y mata el proceso si no la hay
 * (EXC_BREAKPOINT en __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
 *
 * La ventana se construye acá, instanciando Main.storyboard igual que antes, así el
 * root sigue siendo el CAPBridgeViewController y Capacitor no nota la diferencia.
 * Capacitor 7.6.7 no trae soporte de escenas propio, por eso esto es a mano.
 */
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Mismo arranque que antes, solo que atado a la escena en vez de a la app.
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        // La app pudo haberse abierto por deep link o Universal Link: con escenas eso
        // ya no llega al AppDelegate, viene en connectionOptions.
        if let urlContext = connectionOptions.urlContexts.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: urlContext.url, options: [:])
        }
        if let userActivity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }

    // Deep link con la app ya abierta.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let urlContext = URLContexts.first else { return }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, open: urlContext.url, options: [:])
    }

    // Universal Link con la app ya abierta.
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
