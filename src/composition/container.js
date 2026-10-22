import * as database from "../data/database.js";
import { isOpenAiDirectModel, runGptImageEdit } from "../data/openaiImage.js";
import * as replicate from "../data/replicate.js";
import * as storage from "../data/storage.js";
import { createOrderService } from "../domain/orderService.js";
import { PROCESSING_STALE_MS } from "../domain/orderTiming.js";

export const orderService = createOrderService({
  getOrder: database.getOrder,
  updatePhotoOutput: database.updatePhotoOutput,
  setOrderStatus: database.setOrderStatus,
  refundOrder: database.refundOrder,
  isOrderPaid: database.isOrderPaid,
  claimOrder: database.claimOrder,
  processingStaleMs: PROCESSING_STALE_MS,
  runImageEdit: replicate.runImageEdit,
  runGptImageEdit,
  isOpenAiDirectModel,
  uploadImageFromUrl: storage.uploadImageFromUrl,
});
