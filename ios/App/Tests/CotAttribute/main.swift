import Foundation

private func expect(
    _ expected: String?,
    _ xml: String,
    tag: String,
    name: String,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    let actual = cotAttribute(xml, tag: tag, name: name)
    guard actual == expected else {
        fatalError(
            "Expected \(String(describing: expected)), got \(String(describing: actual))",
            file: file,
            line: line
        )
    }
}

let standard = """
<event uid="IOS-1" type="a-f-G-U-C">
  <detail>
    <contact callsign="Al &amp; Field &lt;One&gt;"/>
    <__group name="&quot;Green&quot; &apos;Team&apos;"/>
  </detail>
</event>
"""
expect("Al & Field <One>", standard, tag: "contact", name: "callsign")
expect("\"Green\" 'Team'", standard, tag: "__group", name: "name")

let singleQuoted = "<event uid='Al &#38; Field &#x1F331;' type = 'a-f-G-U-C'/>"
expect("Al & Field 🌱", singleQuoted, tag: "event", name: "uid")
expect("a-f-G-U-C", singleQuoted, tag: "event", name: "type")

let tagPrefix = """
<contacts callsign="Wrong"/>
<contact callsign="Right"/>
"""
expect("Right", tagPrefix, tag: "contact", name: "callsign")

expect(nil, "<contact callsign=\"Al &custom;\"/>", tag: "contact", name: "callsign")
expect(nil, "<contact callsign=\"Al &amp\"/>", tag: "contact", name: "callsign")
expect(nil, "<contact callsign=\"Al &#xD800;\"/>", tag: "contact", name: "callsign")

let oversizedXml = "<contact callsign=\"Al\"/>" + String(
    repeating: "x",
    count: 1024 * 1024
)
expect(nil, oversizedXml, tag: "contact", name: "callsign")

let oversizedTag = "<contact " + String(
    repeating: "x",
    count: 64 * 1024 + 1
) + " callsign=\"Al\"/>"
expect(nil, oversizedTag, tag: "contact", name: "callsign")

print("CoT attribute tests passed")
