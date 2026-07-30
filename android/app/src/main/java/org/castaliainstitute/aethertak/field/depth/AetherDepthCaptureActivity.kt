package org.castaliainstitute.aethertak.field.depth

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.media.Image
import android.net.Uri
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.view.Gravity
import android.view.Surface
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.NotYetAvailableException
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.max
import kotlin.math.min

class AetherDepthCaptureActivity : Activity(), GLSurfaceView.Renderer {
    companion object {
        const val EXTRA_COORDINATE = "coordinate"
        const val EXTRA_MODE = "mode"
        const val EXTRA_RESULT = "result"
        const val EXTRA_ERROR_CODE = "errorCode"
        const val EXTRA_ERROR_MESSAGE = "errorMessage"
        const val ACTION_CANCEL =
            "org.castaliainstitute.aethertak.field.action.CANCEL_DEPTH_SCAN"

        private const val CAMERA_PERMISSION_REQUEST = 7001
        private const val VERTEX_SHADER = """
            attribute vec4 a_Position;
            attribute vec2 a_TexCoord;
            varying vec2 v_TexCoord;
            void main() {
                gl_Position = a_Position;
                v_TexCoord = a_TexCoord;
            }
        """
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES sTexture;
            varying vec2 v_TexCoord;
            void main() {
                gl_FragColor = texture2D(sTexture, v_TexCoord);
            }
        """
    }

    private lateinit var surfaceView: GLSurfaceView
    private lateinit var statusLabel: TextView
    private lateinit var captureButton: Button
    private var session: Session? = null
    private var installRequested = false
    private var viewportWidth = 1
    private var viewportHeight = 1
    private var cameraTexture = 0
    private var backgroundProgram = 0
    private val captureRequested = AtomicBoolean(false)
    private val exportStarted = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private var receiverRegistered = false

    private val cancelReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finishError("CANCELLED", "Depth capture was cancelled.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildInterface()
        ContextCompat.registerReceiver(
            this,
            cancelReceiver,
            IntentFilter(ACTION_CANCEL),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        receiverRegistered = true
    }

    override fun onResume() {
        super.onResume()
        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.CAMERA),
                CAMERA_PERMISSION_REQUEST,
            )
            return
        }
        startArSession()
    }

    override fun onPause() {
        surfaceView.onPause()
        session?.pause()
        super.onPause()
    }

    override fun onDestroy() {
        session?.close()
        session = null
        executor.shutdownNow()
        if (receiverRegistered) {
            unregisterReceiver(cancelReceiver)
            receiverRegistered = false
        }
        super.onDestroy()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != CAMERA_PERMISSION_REQUEST) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startArSession()
        } else {
            finishError("PERMISSION_DENIED", "Camera permission is required for ARCore depth.")
        }
    }

    private fun startArSession() {
        try {
            when (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
                ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
                    installRequested = true
                    updateStatus("Install or update Google Play Services for AR, then return.")
                    return
                }
                ArCoreApk.InstallStatus.INSTALLED -> Unit
            }
            if (session == null) {
                val created = Session(this)
                if (!created.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                    created.close()
                    finishError(
                        "UNAVAILABLE",
                        "This ARCore device does not support the Depth API.",
                    )
                    return
                }
                created.configure(
                    created.config.apply {
                        depthMode = Config.DepthMode.AUTOMATIC
                        focusMode = Config.FocusMode.AUTO
                    },
                )
                session = created
            }
            session?.resume()
            surfaceView.onResume()
            updateStatus("Move slowly around the subject to build depth")
        } catch (error: Exception) {
            finishError("UNAVAILABLE", error.message ?: "ARCore could not start.")
        }
    }

    private fun buildInterface() {
        surfaceView = GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            preserveEGLContextOnPause = true
            setRenderer(this@AetherDepthCaptureActivity)
            renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        }
        val root = FrameLayout(this)
        root.addView(
            surfaceView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )

        statusLabel = TextView(this).apply {
            text = "Starting ARCore…"
            setTextColor(Color.WHITE)
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(24, 20, 24, 20)
            setBackgroundColor(0xAA111820.toInt())
        }
        captureButton = Button(this).apply {
            text = "Capture depth"
            isEnabled = false
            setOnClickListener {
                isEnabled = false
                updateStatus("Hold steady while depth and confidence are captured…")
                captureRequested.set(true)
            }
        }
        val cancelButton = Button(this).apply {
            text = "Cancel"
            setOnClickListener {
                finishError("CANCELLED", "Depth capture was cancelled.")
            }
        }
        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(24, 24, 24, 24)
            setBackgroundColor(0x88111820.toInt())
            addView(
                statusLabel,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            addView(
                captureButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
            addView(
                cancelButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        root.addView(
            controls,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM,
            ).apply {
                marginStart = 24
                marginEnd = 24
                bottomMargin = 24
            },
        )
        setContentView(root)
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        cameraTexture = createExternalTexture()
        backgroundProgram = createProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        viewportWidth = width
        viewportHeight = height
        GLES20.glViewport(0, 0, width, height)
        session?.setDisplayGeometry(displayRotation(), width, height)
    }

    override fun onDrawFrame(gl: GL10?) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
        val activeSession = session ?: return
        try {
            activeSession.setCameraTextureName(cameraTexture)
            activeSession.setDisplayGeometry(displayRotation(), viewportWidth, viewportHeight)
            val frame = activeSession.update()
            if (frame.timestamp != 0L) drawCameraBackground(frame)

            val ready = frame.camera.trackingState == TrackingState.TRACKING
            runOnUiThread {
                if (!captureRequested.get() && !exportStarted.get()) {
                    captureButton.isEnabled = ready
                    statusLabel.text = if (ready) {
                        "Depth tracking active — hold steady and capture"
                    } else {
                        "Move slowly around the subject to build depth"
                    }
                }
            }
            if (captureRequested.get() && ready && !exportStarted.get()) {
                acquireAndExport(frame)
            }
        } catch (_: CameraNotAvailableException) {
            runOnUiThread {
                finishError("CAMERA_UNAVAILABLE", "The ARCore camera became unavailable.")
            }
        } catch (_: Exception) {
            // Transient AR frames can fail while tracking initializes; keep the session alive.
        }
    }

    private fun acquireAndExport(frame: Frame) {
        try {
            val depthImage = frame.acquireDepthImage16Bits()
            val confidenceImage = frame.acquireRawDepthConfidenceImage()
            val cameraImage = frame.acquireCameraImage()
            val depth = depthImage.use(::copyDepth16)
            val confidence = confidenceImage.use(::copyConfidence)
            val preview = cameraImage.use(::encodeCameraJpeg)
            val intrinsics = frame.camera.imageIntrinsics
            val focal = intrinsics.focalLength
            val principal = intrinsics.principalPoint
            val imageDimensions = intrinsics.imageDimensions
            val pose = frame.camera.pose
            if (!exportStarted.compareAndSet(false, true)) return
            captureRequested.set(false)
            executor.execute {
                try {
                    val result = AetherAndroidDepthExporter.export(
                        filesDir = filesDir,
                        coordinate = JSONObject(
                            intent.getStringExtra(EXTRA_COORDINATE) ?: "{}",
                        ),
                        depth = depth,
                        confidence = confidence,
                        previewJpeg = preview,
                        focalLength = focal,
                        principalPoint = principal,
                        imageDimensions = imageDimensions,
                        cameraPose = pose,
                    )
                    runOnUiThread {
                        setResult(
                            RESULT_OK,
                            Intent().putExtra(EXTRA_RESULT, result.toString()),
                        )
                        finish()
                    }
                } catch (error: Exception) {
                    runOnUiThread {
                        finishError(
                            "EXPORT_FAILED",
                            error.message ?: "Depth export failed.",
                        )
                    }
                }
            }
        } catch (_: NotYetAvailableException) {
            updateStatus("Depth is still resolving — keep moving slowly, then hold steady")
        }
    }

    private fun finishError(code: String, message: String) {
        if (isFinishing) return
        setResult(
            RESULT_CANCELED,
            Intent()
                .putExtra(EXTRA_ERROR_CODE, code)
                .putExtra(EXTRA_ERROR_MESSAGE, message),
        )
        finish()
    }

    private fun updateStatus(message: String) {
        runOnUiThread { statusLabel.text = message }
    }

    @Suppress("DEPRECATION")
    private fun displayRotation(): Int =
        if (android.os.Build.VERSION.SDK_INT >= 30) display?.rotation ?: Surface.ROTATION_0
        else windowManager.defaultDisplay.rotation

    private fun drawCameraBackground(frame: Frame) {
        val positions = floatBuffer(
            floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f),
        )
        val textureCoordinates = ByteBuffer
            .allocateDirect(8 * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
        frame.transformCoordinates2d(
            Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,
            positions,
            Coordinates2d.TEXTURE_NORMALIZED,
            textureCoordinates,
        )
        positions.position(0)
        textureCoordinates.position(0)

        GLES20.glDisable(GLES20.GL_DEPTH_TEST)
        GLES20.glUseProgram(backgroundProgram)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, cameraTexture)
        val positionLocation = GLES20.glGetAttribLocation(backgroundProgram, "a_Position")
        val textureLocation = GLES20.glGetAttribLocation(backgroundProgram, "a_TexCoord")
        GLES20.glEnableVertexAttribArray(positionLocation)
        GLES20.glEnableVertexAttribArray(textureLocation)
        GLES20.glVertexAttribPointer(
            positionLocation,
            2,
            GLES20.GL_FLOAT,
            false,
            0,
            positions,
        )
        GLES20.glVertexAttribPointer(
            textureLocation,
            2,
            GLES20.GL_FLOAT,
            false,
            0,
            textureCoordinates,
        )
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(positionLocation)
        GLES20.glDisableVertexAttribArray(textureLocation)
    }

    private fun createExternalTexture(): Int {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textures[0])
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MIN_FILTER,
            GLES20.GL_LINEAR,
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_MAG_FILTER,
            GLES20.GL_LINEAR,
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_S,
            GLES20.GL_CLAMP_TO_EDGE,
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES,
            GLES20.GL_TEXTURE_WRAP_T,
            GLES20.GL_CLAMP_TO_EDGE,
        )
        return textures[0]
    }

    private fun createProgram(vertexSource: String, fragmentSource: String): Int {
        fun compile(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, source)
            GLES20.glCompileShader(shader)
            val status = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0)
            check(status[0] == GLES20.GL_TRUE) {
                "OpenGL shader compilation failed: ${GLES20.glGetShaderInfoLog(shader)}"
            }
            return shader
        }
        val program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, compile(GLES20.GL_VERTEX_SHADER, vertexSource))
        GLES20.glAttachShader(program, compile(GLES20.GL_FRAGMENT_SHADER, fragmentSource))
        GLES20.glLinkProgram(program)
        return program
    }

    private fun floatBuffer(values: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(values.size * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer()
            .apply {
                put(values)
                position(0)
            }

    data class DepthGrid(val width: Int, val height: Int, val bytes: ByteArray)

    private fun copyDepth16(image: Image): DepthGrid {
        val plane = image.planes[0]
        val input = plane.buffer
        val output = ByteArray(image.width * image.height * 2)
        var target = 0
        for (y in 0 until image.height) {
            for (x in 0 until image.width) {
                val source = y * plane.rowStride + x * plane.pixelStride
                output[target++] = input.get(source)
                output[target++] = input.get(source + 1)
            }
        }
        return DepthGrid(image.width, image.height, output)
    }

    private fun copyConfidence(image: Image): ByteArray {
        val plane = image.planes[0]
        val input = plane.buffer
        return ByteArray(image.width * image.height).also { output ->
            var target = 0
            for (y in 0 until image.height) {
                for (x in 0 until image.width) {
                    output[target++] = input.get(
                        y * plane.rowStride + x * plane.pixelStride,
                    )
                }
            }
        }
    }

    private fun encodeCameraJpeg(image: Image): ByteArray {
        val width = image.width
        val height = image.height
        val nv21 = ByteArray(width * height * 3 / 2)
        val yPlane = image.planes[0]
        var target = 0
        for (y in 0 until height) {
            for (x in 0 until width) {
                nv21[target++] = yPlane.buffer.get(
                    y * yPlane.rowStride + x * yPlane.pixelStride,
                )
            }
        }
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]
        for (y in 0 until height / 2) {
            for (x in 0 until width / 2) {
                nv21[target++] = vPlane.buffer.get(
                    y * vPlane.rowStride + x * vPlane.pixelStride,
                )
                nv21[target++] = uPlane.buffer.get(
                    y * uPlane.rowStride + x * uPlane.pixelStride,
                )
            }
        }
        return ByteArrayOutputStream().use { stream ->
            check(
                YuvImage(nv21, ImageFormat.NV21, width, height, null)
                    .compressToJpeg(Rect(0, 0, width, height), 90, stream),
            ) { "Could not encode the ARCore camera preview." }
            stream.toByteArray()
        }
    }

}

private object AetherAndroidDepthExporter {
    private data class Point(
        val x: Float,
        val y: Float,
        val z: Float,
        val depthMeters: Float,
        val confidence: Int,
    )

    fun export(
        filesDir: File,
        coordinate: JSONObject,
        depth: AetherDepthCaptureActivity.DepthGrid,
        confidence: ByteArray,
        previewJpeg: ByteArray,
        focalLength: FloatArray,
        principalPoint: FloatArray,
        imageDimensions: IntArray,
        cameraPose: com.google.ar.core.Pose,
    ): JSONObject {
        val id = UUID.randomUUID()
        val directory = File(filesDir, "DepthScans/${id.toString().lowercase()}")
        check(directory.mkdirs() || directory.isDirectory) {
            "Could not create private depth scan storage."
        }
        val previewFile = File(directory, "preview.jpg")
        val depthFile = File(directory, "depth.u16le")
        val confidenceFile = File(directory, "confidence.u8")
        val cloudFile = File(directory, "point-cloud.ply")

        previewFile.writeBytes(previewJpeg)
        depthFile.outputStream().buffered().use { output ->
            output.write("AETHER_DEPTH_U16LE_MM\n${depth.width} ${depth.height}\n".toByteArray())
            output.write(depth.bytes)
        }
        confidenceFile.outputStream().buffered().use { output ->
            output.write("AETHER_CONFIDENCE_U8\n${depth.width} ${depth.height}\n".toByteArray())
            output.write(confidence)
        }

        val points = createPoints(
            depth,
            confidence,
            focalLength,
            principalPoint,
            imageDimensions,
            cameraPose,
        )
        check(points.isNotEmpty()) { "No valid ARCore depth samples were captured." }
        cloudFile.bufferedWriter().use { output ->
            output.appendLine("ply")
            output.appendLine("format ascii 1.0")
            output.appendLine(
                "comment AetherTAK Field ARCore depth, meters in ARCore world coordinates",
            )
            output.appendLine("element vertex ${points.size}")
            output.appendLine("property float x")
            output.appendLine("property float y")
            output.appendLine("property float z")
            output.appendLine("property uchar confidence")
            output.appendLine("end_header")
            points.forEach { point ->
                output.appendLine(
                    "${point.x} ${point.y} ${point.z} ${point.confidence}",
                )
            }
        }

        val measurements = measurements(points)
        return JSONObject().apply {
            put("id", id.toString().lowercase())
            put("provider", "arcore-depth")
            put("capturedAt", Instant.now().toString())
            put("coordinate", normalizeCoordinate(coordinate))
            put("previewUri", Uri.fromFile(previewFile).toString())
            put("depthUri", Uri.fromFile(depthFile).toString())
            put("confidenceUri", Uri.fromFile(confidenceFile).toString())
            put("pointCloudUri", Uri.fromFile(cloudFile).toString())
            put("modelUri", JSONObject.NULL)
            put("measurements", measurements)
        }
    }

    private fun createPoints(
        depth: AetherDepthCaptureActivity.DepthGrid,
        confidence: ByteArray,
        focalLength: FloatArray,
        principalPoint: FloatArray,
        imageDimensions: IntArray,
        cameraPose: com.google.ar.core.Pose,
    ): List<Point> {
        val scaleX = depth.width.toFloat() / imageDimensions[0].toFloat()
        val scaleY = depth.height.toFloat() / imageDimensions[1].toFloat()
        val fx = focalLength[0] * scaleX
        val fy = focalLength[1] * scaleY
        val cx = principalPoint[0] * scaleX
        val cy = principalPoint[1] * scaleY
        val buffer = ByteBuffer.wrap(depth.bytes).order(ByteOrder.LITTLE_ENDIAN)
        val points = ArrayList<Point>(depth.width * depth.height / 4)
        for (y in 0 until depth.height step 2) {
            for (x in 0 until depth.width step 2) {
                val index = y * depth.width + x
                val millimeters = buffer.getShort(index * 2).toInt() and 0xffff
                if (millimeters == 0 || millimeters > 65_000) continue
                val z = millimeters / 1000f
                val cameraPoint = floatArrayOf(
                    (x - cx) * z / fx,
                    -(y - cy) * z / fy,
                    -z,
                )
                val world = cameraPose.transformPoint(cameraPoint)
                points += Point(
                    world[0],
                    world[1],
                    world[2],
                    z,
                    confidence.getOrElse(index) { 0 }.toInt() and 0xff,
                )
            }
        }
        return points
    }

    private fun measurements(points: List<Point>): JSONArray {
        val width = (points.maxOf { it.x } - points.minOf { it.x }).toDouble()
        val height = (points.maxOf { it.y } - points.minOf { it.y }).toDouble()
        val depth = (points.maxOf { it.z } - points.minOf { it.z }).toDouble()
        val ranges = points.map { it.depthMeters }.sorted()
        val median = ranges[ranges.size / 2].toDouble()
        val confidence = points.sumOf { it.confidence }.toDouble() / points.size / 255.0
        val uncertainty = max(0.02, 0.22 - min(1.0, confidence) * 0.2)
        return JSONArray().apply {
            put(measurement("Median range", median, "m", uncertainty))
            put(measurement("Bounds width", width, "m", uncertainty))
            put(measurement("Bounds height", height, "m", uncertainty))
            put(measurement("Bounds depth", depth, "m", uncertainty))
            put(measurement("Projected area", width * height, "m2", uncertainty * 2))
            put(measurement("Bounding volume", width * height * depth, "m3", uncertainty * 3))
        }
    }

    private fun measurement(
        label: String,
        value: Double,
        unit: String,
        uncertainty: Double,
    ) = JSONObject().apply {
        put("label", label)
        put("value", value)
        put("unit", unit)
        put("uncertainty", uncertainty)
    }

    private fun normalizeCoordinate(source: JSONObject) = JSONObject().apply {
        put("latitude", source.optDouble("latitude", 0.0))
        put("longitude", source.optDouble("longitude", 0.0))
        listOf(
            "altitudeMeters",
            "horizontalAccuracyMeters",
            "verticalAccuracyMeters",
            "headingDegrees",
        ).forEach { key ->
            put(key, if (source.isNull(key)) JSONObject.NULL else source.opt(key))
        }
    }
}
