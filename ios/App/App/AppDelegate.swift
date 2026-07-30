import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var privacyShield: UIView?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        protectLocalOperationalData()
        return true
    }

    private func protectLocalOperationalData() {
        let manager = FileManager.default
        guard
            let library = manager.urls(
                for: .libraryDirectory,
                in: .userDomainMask
            ).first,
            let documents = manager.urls(
                for: .documentDirectory,
                in: .userDomainMask
            ).first
        else {
            return
        }
        let directories = [
            library.appendingPathComponent("WebKit", isDirectory: true),
            library.appendingPathComponent("NoCloud", isDirectory: true),
            documents.appendingPathComponent("observations", isDirectory: true),
            documents.appendingPathComponent("mission-packages", isDirectory: true)
        ]
        for directory in directories {
            do {
                try manager.createDirectory(
                    at: directory,
                    withIntermediateDirectories: true,
                    attributes: [
                        .protectionKey:
                            FileProtectionType
                            .completeUntilFirstUserAuthentication
                    ]
                )
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var protectedDirectory = directory
                try protectedDirectory.setResourceValues(values)
            } catch {
                NSLog(
                    "AetherTAK could not protect local operational data: %@",
                    error.localizedDescription
                )
            }
        }
    }

    private func showPrivacyShield() {
        guard let window else { return }
        if let privacyShield {
            window.bringSubviewToFront(privacyShield)
            return
        }

        let shield = UIView(frame: window.bounds)
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.backgroundColor = UIColor(
            red: 13.0 / 255.0,
            green: 21.0 / 255.0,
            blue: 17.0 / 255.0,
            alpha: 1
        )

        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(
            red: 155.0 / 255.0,
            green: 225.0 / 255.0,
            blue: 136.0 / 255.0,
            alpha: 1
        )
        label.font = .systemFont(ofSize: 20, weight: .semibold)
        label.text = "AetherTAK Field\nProtected while inactive"
        shield.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: shield.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: shield.centerYAnchor),
            label.leadingAnchor.constraint(
                greaterThanOrEqualTo: shield.leadingAnchor,
                constant: 24
            ),
            label.trailingAnchor.constraint(
                lessThanOrEqualTo: shield.trailingAnchor,
                constant: -24
            )
        ])

        window.addSubview(shield)
        privacyShield = shield
    }

    private func hidePrivacyShield() {
        privacyShield?.removeFromSuperview()
        privacyShield = nil
    }

    func applicationWillResignActive(_ application: UIApplication) {
        showPrivacyShield()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        showPrivacyShield()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Keep the shield visible through the foreground transition. UIKit can
        // display the task-switcher snapshot until the app becomes active.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        hidePrivacyShield()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
