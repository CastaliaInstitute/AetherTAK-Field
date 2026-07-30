package org.castaliainstitute.aethertak.field.tak

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CotAttributeTest {
    @Test
    fun `decodes predefined entities from double quoted attributes`() {
        val xml = """
            <event uid="ANDROID-1" type="a-f-G-U-C">
              <detail>
                <contact callsign="Al &amp; Field &lt;One&gt;"/>
                <__group name="&quot;Green&quot; &apos;Team&apos;"/>
              </detail>
            </event>
        """.trimIndent()

        assertEquals("Al & Field <One>", cotAttribute(xml, "contact", "callsign"))
        assertEquals("\"Green\" 'Team'", cotAttribute(xml, "__group", "name"))
    }

    @Test
    fun `supports single quoted attributes and numeric references`() {
        val xml = "<event uid='Al &#38; Field &#x1F331;' type = 'a-f-G-U-C'/>"

        assertEquals("Al & Field 🌱", cotAttribute(xml, "event", "uid"))
        assertEquals("a-f-G-U-C", cotAttribute(xml, "event", "type"))
    }

    @Test
    fun `matches the exact element rather than a tag prefix`() {
        val xml = """
            <contacts callsign="Wrong"/>
            <contact callsign="Right"/>
        """.trimIndent()

        assertEquals("Right", cotAttribute(xml, "contact", "callsign"))
    }

    @Test
    fun `rejects malformed custom and invalid numeric entities`() {
        assertNull(cotAttribute("<contact callsign=\"Al &custom;\"/>", "contact", "callsign"))
        assertNull(cotAttribute("<contact callsign=\"Al &amp\"/>", "contact", "callsign"))
        assertNull(cotAttribute("<contact callsign=\"Al &#xD800;\"/>", "contact", "callsign"))
    }

    @Test
    fun `rejects oversized XML and start tags`() {
        val oversizedXml = "<contact callsign=\"Al\"/>" + "x".repeat(1024 * 1024)
        val oversizedTag = "<contact " + "x".repeat(64 * 1024 + 1) + " callsign=\"Al\"/>"

        assertNull(cotAttribute(oversizedXml, "contact", "callsign"))
        assertNull(cotAttribute(oversizedTag, "contact", "callsign"))
    }
}
