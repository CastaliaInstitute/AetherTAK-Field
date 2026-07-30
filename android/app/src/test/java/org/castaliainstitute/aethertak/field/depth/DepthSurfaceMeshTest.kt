package org.castaliainstitute.aethertak.field.depth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DepthSurfaceMeshTest {
    @Test
    fun `triangulates a calibrated planar depth grid`() {
        val mesh = buildDepthSurfaceMesh(
            width = 4,
            height = 4,
            depthMillimetersLittleEndian = depthGrid(4, 4) { 1_000 },
            focalX = 8f,
            focalY = 8f,
            centerX = 1.5f,
            centerY = 1.5f,
            sampleStep = 1,
        )

        assertEquals(16, mesh.vertices.size)
        assertEquals(18, mesh.faces.size)
        assertEquals(-1f, mesh.vertices.first().z)
        assertTrue(mesh.faces.all { face ->
            face.first in mesh.vertices.indices &&
                face.second in mesh.vertices.indices &&
                face.third in mesh.vertices.indices
        })
    }

    @Test
    fun `does not bridge missing samples or sharp depth discontinuities`() {
        val bytes = depthGrid(3, 2) { 1_000 }
        setDepth(bytes, pixelIndex = 1, millimeters = 0)
        setDepth(bytes, pixelIndex = 5, millimeters = 4_000)

        val mesh = buildDepthSurfaceMesh(
            width = 3,
            height = 2,
            depthMillimetersLittleEndian = bytes,
            focalX = 3f,
            focalY = 3f,
            centerX = 1f,
            centerY = 0.5f,
            sampleStep = 1,
        )

        assertEquals(5, mesh.vertices.size)
        assertTrue(mesh.faces.isEmpty())
    }

    @Test
    fun `rejects malformed grids and unsafe calibration`() {
        assertThrows(IllegalArgumentException::class.java) {
            buildDepthSurfaceMesh(
                width = 4,
                height = 4,
                depthMillimetersLittleEndian = byteArrayOf(),
                focalX = 4f,
                focalY = 4f,
                centerX = 2f,
                centerY = 2f,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            buildDepthSurfaceMesh(
                width = 2,
                height = 2,
                depthMillimetersLittleEndian = depthGrid(2, 2) { 1_000 },
                focalX = 0f,
                focalY = 2f,
                centerX = 1f,
                centerY = 1f,
            )
        }
    }

    private fun depthGrid(
        width: Int,
        height: Int,
        value: (Int) -> Int,
    ): ByteArray = ByteArray(width * height * 2).also { bytes ->
        repeat(width * height) { index ->
            setDepth(bytes, index, value(index))
        }
    }

    private fun setDepth(bytes: ByteArray, pixelIndex: Int, millimeters: Int) {
        bytes[pixelIndex * 2] = (millimeters and 0xff).toByte()
        bytes[pixelIndex * 2 + 1] = ((millimeters ushr 8) and 0xff).toByte()
    }
}
