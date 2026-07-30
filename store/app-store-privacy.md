# App Store privacy answers

These answers describe the current AetherTAK Field code and must be reviewed against the production server and its privacy policy before submission.

- Data used to track users: **No**
- Third-party advertising: **No**
- Purpose for every collected category: **App Functionality**
- Linked to the user's identity: **Yes**. TAK callsign/UID and mission records associate operational data with a user profile.

Declare these collected categories:

- Location: Precise Location; Coarse Location
- Identifiers: User ID
- User Content: Emails or Text Messages; Photos or Videos; Audio Data; Other User Content
- Other Data: Environment Scanning

Collection is feature-initiated except that a connected TAK profile sends its identity and may publish team position while PLI is enabled. The app declares no tracking domains. A public privacy-policy URL, support URL, retention policy, and operator contact remain submission-time requirements.

The native privacy manifest is `ios/App/App/PrivacyInfo.xcprivacy`. It also declares the required-reason API categories used by the app and Capacitor: app-only preferences (`CA92.1`) and file timestamps inside the app container (`C617.1`).
