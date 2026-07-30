package org.castaliainstitute.aethertak.field.depth

import kotlin.math.abs
import kotlin.math.max

data class DepthSurfaceVertex(
    val x: Float,
    val y: Float,
    val z: Float,
)

data class DepthSurfaceFace(
    val first: Int,
    val second: Int,
    val third: Int,
)

data class DepthSurfaceMesh(
    val vertices: List<DepthSurfaceVertex>,
    val faces: List<DepthSurfaceFace>,
)

fun buildDepthSurfaceMesh(
    width: Int,
    height: Int,
    depthMillimetersLittleEndian: ByteArray,
    focalX: Float,
    focalY: Float,
    centerX: Float,
    centerY: Float,
    sampleStep: Int = 2,
): DepthSurfaceMesh {
    require(width > 1 && height > 1) { "Depth dimensions must exceed one pixel." }
    require(
        depthMillimetersLittleEndian.size.toLong() == width.toLong() * height * 2,
    ) { "Depth data length does not match its dimensions." }
    require(focalX.isFinite() && focalX > 0 && focalY.isFinite() && focalY > 0) {
        "Depth camera focal lengths must be finite and positive."
    }
    require(centerX.isFinite() && centerY.isFinite()) {
        "Depth camera principal point must be finite."
    }
    require(sampleStep in 1..16) { "Depth surface sample step is invalid." }

    val sampledX = (0 until width step sampleStep).toList()
    val sampledY = (0 until height step sampleStep).toList()
    require(sampledX.size.toLong() * sampledY.size <= MAXIMUM_SURFACE_VERTICES) {
        "Depth surface exceeds the bounded vertex limit."
    }

    val vertices = ArrayList<DepthSurfaceVertex>(sampledX.size * sampledY.size)
    val vertexAt = IntArray(sampledX.size * sampledY.size) { -1 }
    for ((row, y) in sampledY.withIndex()) {
        for ((column, x) in sampledX.withIndex()) {
            val millimeters = depthMillimeters(
                depthMillimetersLittleEndian,
                y * width + x,
            )
            if (millimeters !in MINIMUM_DEPTH_MM..MAXIMUM_DEPTH_MM) continue
            val z = millimeters / 1000f
            vertexAt[row * sampledX.size + column] = vertices.size
            vertices += DepthSurfaceVertex(
                x = (x - centerX) * z / focalX,
                y = -(y - centerY) * z / focalY,
                z = -z,
            )
        }
    }

    val faces = ArrayList<DepthSurfaceFace>()
    for (row in 0 until sampledY.lastIndex) {
        for (column in 0 until sampledX.lastIndex) {
            val topLeft = vertexAt[row * sampledX.size + column]
            val topRight = vertexAt[row * sampledX.size + column + 1]
            val bottomLeft = vertexAt[(row + 1) * sampledX.size + column]
            val bottomRight = vertexAt[(row + 1) * sampledX.size + column + 1]
            addFace(vertices, faces, topLeft, topRight, bottomLeft)
            addFace(vertices, faces, topRight, bottomRight, bottomLeft)
        }
    }
    require(faces.size <= MAXIMUM_SURFACE_FACES) {
        "Depth surface exceeds the bounded face limit."
    }
    return DepthSurfaceMesh(vertices, faces)
}

private fun addFace(
    vertices: List<DepthSurfaceVertex>,
    faces: MutableList<DepthSurfaceFace>,
    first: Int,
    second: Int,
    third: Int,
) {
    if (first < 0 || second < 0 || third < 0) return
    val triangle = listOf(vertices[first], vertices[second], vertices[third])
    val nearestDepth = triangle.minOf { abs(it.z) }
    val permittedDepthJump = max(MINIMUM_DEPTH_JUMP_METERS, nearestDepth * 0.08f)
    val depthJump = triangle.maxOf { abs(it.z) } - nearestDepth
    if (depthJump > permittedDepthJump) return

    val permittedEdge = max(MINIMUM_EDGE_METERS, nearestDepth * 0.12f)
    if (
        squaredDistance(triangle[0], triangle[1]) > permittedEdge * permittedEdge ||
        squaredDistance(triangle[1], triangle[2]) > permittedEdge * permittedEdge ||
        squaredDistance(triangle[2], triangle[0]) > permittedEdge * permittedEdge
    ) {
        return
    }
    faces += DepthSurfaceFace(first, second, third)
}

private fun squaredDistance(
    first: DepthSurfaceVertex,
    second: DepthSurfaceVertex,
): Float {
    val x = first.x - second.x
    val y = first.y - second.y
    val z = first.z - second.z
    return x * x + y * y + z * z
}

private fun depthMillimeters(bytes: ByteArray, pixelIndex: Int): Int {
    val offset = pixelIndex * 2
    return (bytes[offset].toInt() and 0xff) or
        ((bytes[offset + 1].toInt() and 0xff) shl 8)
}

private const val MINIMUM_DEPTH_MM = 50
private const val MAXIMUM_DEPTH_MM = 65_000
private const val MINIMUM_DEPTH_JUMP_METERS = 0.15f
private const val MINIMUM_EDGE_METERS = 0.25f
private const val MAXIMUM_SURFACE_VERTICES = 100_000L
private const val MAXIMUM_SURFACE_FACES = 200_000
