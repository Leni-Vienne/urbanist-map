<template>
  <!-- AI : Custom draggable bottom drawer with continuous positioning -->
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div
        v-if="visible"
        class="draggable-drawer-container"
        @click.self="handleBackdropClick"
      >
        <div
          ref="drawerRef"
          class="draggable-drawer"
          :style="drawerStyle"
          @touchstart="handleTouchStart"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
          @mousedown="handleMouseDown"
        >
          <!-- AI : Slot for content above drawer (e.g., mode controls) -->
          <div
            class="drawer-above-content"
            :style="{ bottom: aboveContentBottom }"
          >
            <slot name="above"></slot>
          </div>

          <!-- AI : Drag handle at the top -->
          <div
            class="drawer-handle"
            @click.stop
          >
            <div class="handle-bar"></div>
          </div>

          <!-- AI : Header -->
          <div
            class="drawer-header"
            :class="{ 'drawer-header--compact': isCompact }"
          >
            <slot name="header">
              <h3
                class="drawer-title"
                :class="{ 'drawer-title--compact': isCompact }"
              >{{ header }}</h3>
            </slot>
          </div>

          <!-- AI : Content -->
          <div class="drawer-content">
            <slot></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'

interface Props {
  visible: boolean
  header?: string
  heightPercent?: number
}

const props = withDefaults(defineProps<Props>(), {
  header: '',
  heightPercent: 40
})

// AI : Internal configuration (not exposed as props)
const MIN_HEIGHT_PX = 65
const MAX_HEIGHT_PERCENT = 90

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'update:heightPercent': [value: number]
  'heightChanged': [value: number]
}>()

const drawerRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const startY = ref(0)
const startHeight = ref(0)
const currentHeight = ref(props.heightPercent)
const viewportHeight = ref(0)

// AI : Convert minimum height from pixels to viewport percentage
const minHeightPercent = computed(() => {
  return (MIN_HEIGHT_PX / viewportHeight.value) * 100
})

// AI : Calculate safe bottom position for above-content (min 110px from viewport bottom)
const aboveContentBottom = computed(() => {
  const drawerHeightPx = (currentHeight.value / 100) * viewportHeight.value
  const MIN_FROM_BOTTOM = 110 // AI : Minimum pixels from viewport bottom

  // AI : If drawer is below 100px, clamp above-content to stay at 110px from bottom
  if (drawerHeightPx < MIN_FROM_BOTTOM) {
    return `${MIN_FROM_BOTTOM}px`
  }

  // AI : Otherwise, position normally above drawer
  return '100%'
})

// AI : Calculate drawer style with smooth transitions
const drawerStyle = computed(() => {
  const height = Math.min(MAX_HEIGHT_PERCENT, currentHeight.value)
  return {
    height: `${height}vh`,
    transition: isDragging.value ? 'none' : 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
  }
})

// AI : Check if drawer is in compact mode
const isCompact = computed(() => {
  return currentHeight.value <= minHeightPercent.value
})

// AI : Update current height when prop changes
watch(() => props.heightPercent, (newHeight) => {
  if (!isDragging.value) {
    currentHeight.value = newHeight
  }
})

// AI : Keep drawer at minimum height when viewport resizes
watch(() => minHeightPercent.value, (newMinPercent, oldMinPercent) => {
  if (!isDragging.value && oldMinPercent > 0) {
    const wasAtMinimum = Math.abs(currentHeight.value - oldMinPercent) < 0.5
    if (wasAtMinimum) {
      currentHeight.value = newMinPercent
      emit('update:heightPercent', newMinPercent)
      emit('heightChanged', newMinPercent)
    }
  }
})

function handleBackdropClick() {
  // AI : Backdrop clicks disabled for mobile drawer
}

function handleTouchStart(e: TouchEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.drawer-handle') && !target.closest('.drawer-header')) {
    return
  }

  isDragging.value = true
  startY.value = e.touches[0].clientY
  startHeight.value = currentHeight.value
  viewportHeight.value = globalThis.innerHeight
}

function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value) return
  e.preventDefault()

  const deltaY = startY.value - e.touches[0].clientY
  const deltaPercent = (deltaY / viewportHeight.value) * 100

  const newHeight = Math.min(MAX_HEIGHT_PERCENT, startHeight.value + deltaPercent)
  currentHeight.value = newHeight

  // AI : Emit updates during drag for continuous reactivity
  emit('update:heightPercent', newHeight)
  emit('heightChanged', newHeight)
}

function handleTouchEnd() {
  if (!isDragging.value) return

  isDragging.value = false
  finalizePosition()
}

function handleMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.drawer-handle') && !target.closest('.drawer-header')) {
    return
  }

  isDragging.value = true
  startY.value = e.clientY
  startHeight.value = currentHeight.value
  viewportHeight.value = globalThis.innerHeight

  function handleMouseMove(moveEvent: MouseEvent) {
    if (!isDragging.value) return

    const deltaY = startY.value - moveEvent.clientY
    const deltaPercent = (deltaY / viewportHeight.value) * 100

    const newHeight = Math.min(MAX_HEIGHT_PERCENT, startHeight.value + deltaPercent)
    currentHeight.value = newHeight

    // AI : Emit updates during drag for continuous reactivity
    emit('update:heightPercent', newHeight)
    emit('heightChanged', newHeight)
  }

  function handleMouseUp() {
    if (!isDragging.value) return

    isDragging.value = false
    finalizePosition()

    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function finalizePosition() {
  if (currentHeight.value < minHeightPercent.value) {
    currentHeight.value = minHeightPercent.value
  }

  emit('update:heightPercent', currentHeight.value)
  emit('heightChanged', currentHeight.value)
}

// AI : Initialize height on mount
onMounted(() => {
  currentHeight.value = props.heightPercent
  viewportHeight.value = globalThis.innerHeight

  function handleResize() {
    viewportHeight.value = globalThis.innerHeight
  }

  globalThis.addEventListener('resize', handleResize)

  onUnmounted(() => {
    globalThis.removeEventListener('resize', handleResize)
  })
})
</script>

<style scoped>
.draggable-drawer-container {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 1100;
  pointer-events: none;
}

.draggable-drawer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--p-surface-0);
  border-top-left-radius: 1rem;
  border-top-right-radius: 1rem;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: visible;
  z-index: 1101;
  touch-action: none;
  pointer-events: auto;
}

/* AI : Content above drawer - positioned above the drawer, moves with it
   Bottom position is controlled dynamically to ensure min 110px from viewport bottom */
.drawer-above-content {
  position: absolute;
  left: 0;
  right: 0;
  margin-bottom: 0.5rem;
  pointer-events: none;
}

.drawer-handle {
  padding: 0.5rem 0 0.4rem;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: grab;
  flex-shrink: 0;
}

.drawer-handle:active {
  cursor: grabbing;
}

.handle-bar {
  width: 40px;
  height: 4px;
  background: var(--p-surface-300);
  border-radius: 2px;
  transition: background-color 0.2s ease;
}

.drawer-handle:hover .handle-bar {
  background: var(--p-surface-400);
}

.drawer-header {
  padding: 0.5rem 1.5rem 1rem;
  border-bottom: 1px solid var(--p-surface-100);
  flex-shrink: 0;
  background: var(--p-surface-0);
  cursor: grab;
  transition: padding 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-header--compact {
  padding: 0rem 1rem 0.3em;
  text-align: center;
}

.drawer-header:active {
  cursor: grabbing;
}

.drawer-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-surface-900);
  user-select: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-title--compact {
  font-size: 0.875rem;
  font-weight: 500;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--p-surface-0);
}

/* AI : Smooth fade transition */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.3s ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-fade-enter-active .draggable-drawer,
.drawer-fade-leave-active .draggable-drawer {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-fade-enter-from .draggable-drawer,
.drawer-fade-leave-to .draggable-drawer {
  transform: translateY(100%);
}
</style>
