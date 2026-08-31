import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Lee GoogleService-Info.plist del bundle. Sin esto, Messaging no funciona.
        FirebaseApp.configure()
        return true
    }

    // MARK: - Ciclo de vida de escenas (iOS 27+)

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        // El nombre debe coincidir con UISceneConfigurationName del Info.plist.
        return UISceneConfiguration(name: "Default Configuration",
                                    sessionRole: connectingSceneSession.role)
    }

    // MARK: - Push notifications

    /**
     * Canje de token APNs → token FCM.
     *
     * El plugin de Capacitor emite su evento `registration` cuando alguien postea en
     * .capacitorDidRegisterForRemoteNotifications, y acepta tanto `Data` (token crudo de
     * APNs) como `String`. Posteamos el String de FCM a propósito: el dispatcher del ERP
     * envía con firebase-admin, que sólo entiende registration tokens de Firebase y
     * rechazaría un token de APNs con `invalid-argument`.
     */
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken

        Messaging.messaging().token { token, error in
            if let token {
                NotificationCenter.default.post(
                    name: .capacitorDidRegisterForRemoteNotifications, object: token)
            } else {
                NotificationCenter.default.post(
                    name: .capacitorDidFailToRegisterForRemoteNotifications,
                    object: error ?? NSError(domain: "FCM", code: -1, userInfo: [
                        NSLocalizedDescriptionKey: "FCM no devolvió token"
                    ]))
            }
        }
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                       object: error)
    }
}
