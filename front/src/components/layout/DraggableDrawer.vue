<template>
  <!-- Custom draggable bottom drawer with continuous positioning -->
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="visible"
        class="fixed inset-0 z-1100 pointer-events-none"
        @click.self="handleBackdropClick"
      >
        <div
          ref="drawerRef"
          class="draggable-drawer fixed bottom-0 left-0 right-0 bg-content-background rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.15)] flex flex-col overflow-visible z-1101 touch-none pointer-events-auto"
          :style="drawerStyle"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
          @mousedown="handleMouseDown"
        >
          <!-- Slot for content above drawer (e.g., mode controls) -->
          <div
            class="absolute left-0 right-0 mb-2 pointer-events-none"
            :style="{ bottom: aboveContentBottom }"
          >
            <slot name="above" :drawer-height-px="currentDrawerHeightPx"></slot>
          </div>

          <!-- Drag handle at the top -->
          <div
            class="drawer-handle py-2 pb-[0.4rem] flex justify-center items-center cursor-grab active:cursor-grabbing shrink-0 bg-content-hover-background rounded-t-2xl"
            @click.stop
          >
            <div
              class="w-10 h-1 bg-(--p-text-muted-color) rounded-sm transition-colors duration-200 hover:bg-(--p-text-color-secondary)"
            ></div>
          </div>

          <!-- Header -->
          <div
            class="drawer-header shrink-0 bg-content-hover-background cursor-grab active:cursor-grabbing transition-[padding] duration-300 ease-in-out"
            :class="{ 'py-0 px-4 pb-[0.3em] text-center': isCompact }"
          >
            <slot name="header">
              <h3
                class="m-0 text-lg font-semibold text-color select-none transition-all duration-300 ease-in-out"
                :class="{ 'text-sm font-medium': isCompact }"
              >
                {{ header }}
              </h3>
            </slot>
          </div>

          <!-- Content -->
          <div
            class="flex flex-col min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-content-background"
          >
            <slot></slot>
          </div>

          <!-- Footer (outside scroll area so it's always opaque and visible) -->
          <div v-if="$slots.footer" class="shrink-0">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";

interface Props {
  visible: boolean;
  header?: string;
  heightPercent?: number;
}

const props = withDefaults(defineProps<Props>(), {
  header: "",
  heightPercent: 40,
});

// Internal configuration (not exposed as props)
const MIN_HEIGHT_PX = 65;
const MAX_HEIGHT_PERCENT = 75;

const emit = defineEmits<{
  "update:visible": [value: boolean];
  "update:heightPercent": [value: number];
  heightChanged: [value: number];
}>();

const isDragging = ref(false);
const startY = ref(0);
const startHeight = ref(0);
const currentHeight = ref(props.heightPercent);
const viewportHeight = ref(0);

// Convert minimum height from pixels to viewport percentage
const minHeightPercent = computed(() => {
  return (MIN_HEIGHT_PX / viewportHeight.value) * 100;
});

// Calculate current drawer height in pixels for slot consumers
const currentDrawerHeightPx = computed(() => {
  return (currentHeight.value / 100) * viewportHeight.value;
});

// Position above-content exactly at the top of the drawer (100%)
// Clamping logic is now delegated to the slot consumer via drawerHeightPx
const aboveContentBottom = computed(() => {
  return "100%";
});

// Calculate drawer style with smooth transitions
const drawerStyle = computed(() => {
  const height = Math.min(MAX_HEIGHT_PERCENT, currentHeight.value);
  return {
    height: `${height}vh`,
    transition: isDragging.value ? "none" : "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  };
});

// Check if drawer is in compact mode
const isCompact = computed(() => {
  return currentHeight.value <= minHeightPercent.value;
});

// Update current height when prop changes
watch(
  () => props.heightPercent,
  (newHeight) => {
    if (!isDragging.value) {
      currentHeight.value = newHeight;
    }
  },
);

// Keep drawer at minimum height when viewport resizes
watch(
  () => minHeightPercent.value,
  (newMinPercent, oldMinPercent) => {
    if (!isDragging.value && oldMinPercent > 0) {
      const wasAtMinimum = Math.abs(currentHeight.value - oldMinPercent) < 0.5;
      if (wasAtMinimum) {
        currentHeight.value = newMinPercent;
        emit("update:heightPercent", newMinPercent);
        emit("heightChanged", newMinPercent);
      }
    }
  },
);

function handleBackdropClick() {
  // Backdrop clicks disabled for mobile drawer
}

function handleTouchStart(e: TouchEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".drawer-handle") && !target.closest(".drawer-header")) {
    return;
  }

  isDragging.value = true;
  startY.value = e.touches[0]!.clientY;
  startHeight.value = currentHeight.value;
  viewportHeight.value = globalThis.innerHeight;
}

function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value) return;
  e.preventDefault();

  const deltaY = startY.value - e.touches[0]!.clientY;
  const deltaPercent = (deltaY / viewportHeight.value) * 100;

  const newHeight = Math.min(MAX_HEIGHT_PERCENT, startHeight.value + deltaPercent);
  currentHeight.value = newHeight;

  // Emit updates during drag for continuous reactivity
  emit("update:heightPercent", newHeight);
  emit("heightChanged", newHeight);
}

function handleTouchEnd() {
  if (!isDragging.value) return;

  isDragging.value = false;
  finalizePosition();
}

function handleMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".drawer-handle") && !target.closest(".drawer-header")) {
    return;
  }

  isDragging.value = true;
  startY.value = e.clientY;
  startHeight.value = currentHeight.value;
  viewportHeight.value = globalThis.innerHeight;

  function handleMouseMove(moveEvent: MouseEvent) {
    if (!isDragging.value) return;

    const deltaY = startY.value - moveEvent.clientY;
    const deltaPercent = (deltaY / viewportHeight.value) * 100;

    const newHeight = Math.min(MAX_HEIGHT_PERCENT, startHeight.value + deltaPercent);
    currentHeight.value = newHeight;

    // Emit updates during drag for continuous reactivity
    emit("update:heightPercent", newHeight);
    emit("heightChanged", newHeight);
  }

  function handleMouseUp() {
    if (!isDragging.value) return;

    isDragging.value = false;
    finalizePosition();

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
}

function finalizePosition() {
  if (currentHeight.value < minHeightPercent.value) {
    currentHeight.value = minHeightPercent.value;
  }

  emit("update:heightPercent", currentHeight.value);
  emit("heightChanged", currentHeight.value);
}

// Initialize height on mount
onMounted(() => {
  currentHeight.value = props.heightPercent;
  viewportHeight.value = globalThis.innerHeight;

  function handleResize() {
    viewportHeight.value = globalThis.innerHeight;
  }

  globalThis.addEventListener("resize", handleResize);

  onUnmounted(() => {
    globalThis.removeEventListener("resize", handleResize);
  });
});
</script>

<style scoped>
/* Deep children of the above-content slot need pointer events */
:deep(.control-wrapper > *) {
  pointer-events: auto;
}

/* No idea why but those 4 classes below are needed, otherwise the draggable drawer disappears on mobile */
.drawer-fade-enter-from .draggable-drawer,
.drawer-fade-leave-to .draggable-drawer {
  transform: translateY(100%);
}
</style>
