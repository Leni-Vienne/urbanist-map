// @ts-expect-error PrimeVue toasteventbus lacks type declarations
import ToastEventBus from "primevue/toasteventbus";
import { t } from "@/locales";

interface ToastMessage {
  severity?: "success" | "info" | "warn" | "error";
  summary?: string;
  detail?: string;
  life?: number;
}

function showToast(message: ToastMessage): void {
  ToastEventBus.emit("add", message);
}

export function toastError(detail?: string, summary = t("common.error")): void {
  showToast({ severity: "error", summary, detail, life: 5000 });
}

export function toastSuccess(detail?: string, summary = t("common.success")): void {
  showToast({ severity: "success", summary, detail, life: 3000 });
}

export function toastInfo(detail?: string, summary = t("common.info")): void {
  showToast({ severity: "info", summary, detail, life: 3000 });
}

export function toastWarn(detail?: string, summary = t("common.warn")): void {
  showToast({ severity: "warn", summary, detail, life: 5000 });
}
