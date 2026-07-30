# Google Play Data safety answers

These answers describe the current AetherTAK Field code. Reconfirm them for the production server, processors, retention policy, and deletion process before completing Play Console.

- Does the app collect or share required user data types? **Collects data**
- Is all user data encrypted in transit? **Yes**, when deployed with the required HTTPS and TAK mTLS endpoints
- Advertising or tracking purpose: **No**
- Collection purpose: **App functionality**

Declare these collected categories:

- Location: Approximate location; Precise location
- Personal info: User IDs
- Messages: Other in-app messages
- Photos and videos: Photos; Videos
- Audio: Voice or sound recordings
- Files and docs: Files and docs
- Other: Other user-generated content

Media, notes, observations, sensor records, and depth captures are collected only when the user invokes those features. TAK identity is required after enrollment. Position sharing is controlled by the PLI setting.

Do not claim “not shared” until the production operator has confirmed that every server and processor is first-party or qualifies for a Google Play service-provider exemption. Do not claim a deletion-request mechanism until its public process or URL exists.

The Android app requests no broad photo/video library or storage permission and no background-location permission. Camera, microphone, foreground location, and the location foreground service support explicit field-capture and PLI features. Notification permission is requested only when enabling background PLI so its persistent location-sharing notification remains visible; sharing is stopped if notification visibility is revoked.
