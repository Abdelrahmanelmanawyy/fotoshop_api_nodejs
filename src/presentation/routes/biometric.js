import { Router } from "express";
import multer from "multer";
import os from "os";
import path from "path";
import { processBiometricPhoto } from "../../domain/biometricService.js";

const router = Router();

const ALLOWED_IMAGE_EXT = /\.(jpe?g|png|webp)$/i;

/** Flutter/Android often sends application/octet-stream — accept by extension too. */
function isAllowedImageUpload(file) {
  const mime = (file.mimetype || "").toLowerCase();
  if (/^image\/(jpeg|jpg|png|webp)$/i.test(mime)) return true;
  if (mime === "application/octet-stream" && ALLOWED_IMAGE_EXT.test(file.originalname || "")) {
    return true;
  }
  return ALLOWED_IMAGE_EXT.test(file.originalname || "");
}

const upload = multer({
  dest: path.join(os.tmpdir(), "fotoshop-biometric"),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedImageUpload(file)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPEG, PNG, or WebP images are allowed"));
  },
});

function handleMulterUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    console.error("Biometric upload error:", err.message);
    res.status(400).json({
      status: false,
      error: "invalid_upload",
      message: err.message || "Invalid image upload",
    });
  });
}

/**
 * POST /biometric/process
 * multipart: image (file), package (standard | hybrid | combo)
 */
router.post("/process", handleMulterUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: false,
        error: "image is required",
        message: "Upload a portrait photo as multipart field 'image'",
      });
    }

    const packageKey = req.body?.package;
    if (!packageKey) {
      return res.status(400).json({
        status: false,
        error: "package is required",
        message: "Send package=standard, package=hybrid, or package=combo",
      });
    }

    console.log(`[API] POST /biometric/process package=${packageKey} file=${req.file.originalname}`);

    const result = await processBiometricPhoto({
      imagePath: req.file.path,
      packageKey,
      cabinUuid: req.body?.cabin_uuid,
    });

    console.log(`[API] Biometric processed: ${result.image_url ?? "no image url"}`);
    res.json(result);
  } catch (err) {
    console.error("Biometric process error:", err);
    const status = err.message?.includes("Invalid package") ? 400 : 500;
    res.status(status).json({
      status: false,
      error: status === 400 ? "invalid_request" : "processing_failed",
      message: err.message || "Failed to process biometric photo",
    });
  }
});

export default router;
