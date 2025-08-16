<template>
  <div class="change-history-viewer">
    <div class="history-header">
      <h3>Change History</h3>
      <div class="history-filters">
        <select v-model="selectedEntityType" @change="loadHistory">
          <option value="">All Types</option>
          <option value="project">Projects</option>
          <option value="overlay">Overlays</option>
        </select>
        <input 
          v-model="entityIdFilter" 
          @input="loadHistory"
          placeholder="Entity ID (optional)"
          class="entity-filter"
        />
        <Button
          icon="pi pi-refresh"
          @click="loadHistory"
          size="small"
          label="Refresh"
        />
      </div>
    </div>

    <div v-if="isLoading" class="loading-state">
      <i class="pi pi-spin pi-spinner"></i>
      Loading change history...
    </div>

    <div v-else-if="changeHistory.length === 0" class="empty-state">
      <i class="pi pi-history"></i>
      <p>No change history found</p>
    </div>

    <div v-else class="history-timeline">
      <div 
        v-for="entry in changeHistory" 
        :key="entry.id"
        class="history-entry"
      >
        <div class="entry-marker"></div>
        <div class="entry-content">
          <div class="entry-header">
            <span class="entity-type">{{ entry.entityType }}</span>
            <span class="entity-id">{{ entry.entityId.slice(0, 8) }}...</span>
            <span class="field-name">{{ entry.fieldName }}</span>
            <span class="timestamp">{{ formatDate(entry.appliedAt) }}</span>
          </div>
          
          <div class="entry-change">
            <div class="change-values">
              <div class="old-value">
                <label>Before:</label>
                <pre>{{ formatValue(entry.oldValue) }}</pre>
              </div>
              <div class="new-value">
                <label>After:</label>
                <pre>{{ formatValue(entry.newValue) }}</pre>
              </div>
            </div>
          </div>

          <div class="entry-footer">
            <span v-if="entry.changedBy" class="changed-by">
              Changed by: {{ entry.changedBy }}
            </span>
            <span v-if="entry.approvedBy" class="approved-by">
              Approved by: {{ entry.approvedBy }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useChangeRequests } from '../../composables/changes/useChangeRequests'
import Button from 'primevue/button'
import type { ChangeHistoryEntry } from '../../types/api'

interface Props {
  entityType?: 'project' | 'overlay'
  entityId?: string
}

const props = withDefaults(defineProps<Props>(), {
  entityType: undefined,
  entityId: undefined
})

const { getChangeHistory, isLoading, changeHistory } = useChangeRequests()

const selectedEntityType = ref<string>(props.entityType ?? '')
const entityIdFilter = ref<string>(props.entityId ?? '')

async function loadHistory() {
  try {
    await getChangeHistory(
      selectedEntityType.value ? selectedEntityType.value as 'project' | 'overlay' : undefined,
      entityIdFilter.value || undefined
    )
  } catch (error) {
    console.error('Failed to load change history:', error)
  }
}

function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString()
}

onMounted(() => {
  loadHistory()
})
</script>

<style scoped>
.change-history-viewer {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.history-header h3 {
  margin: 0;
  color: #374151;
  font-size: 1.125rem;
  font-weight: 600;
}

.history-filters {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.history-filters select {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: white;
  font-size: 0.875rem;
}

.entity-filter {
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.875rem;
  width: 200px;
}

.loading-state, .empty-state {
  text-align: center;
  padding: 2rem;
  color: #6b7280;
}

.empty-state i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  display: block;
}

.history-timeline {
  position: relative;
  padding-left: 2rem;
}

.history-timeline::before {
  content: '';
  position: absolute;
  left: 1rem;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #e5e7eb;
}

.history-entry {
  position: relative;
  margin-bottom: 1.5rem;
}

.entry-marker {
  position: absolute;
  left: -2rem;
  top: 0.5rem;
  width: 12px;
  height: 12px;
  background: #3b82f6;
  border: 3px solid white;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #e5e7eb;
}

.entry-content {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 1rem;
}

.entry-header {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
}

.entity-type {
  background: #ddd6fe;
  color: #7c3aed;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-weight: 500;
}

.entity-id {
  background: #e0e7ff;
  color: #3730a3;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-family: 'Courier New', monospace;
}

.field-name {
  background: #fef3c7;
  color: #92400e;
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  font-weight: 500;
}

.timestamp {
  margin-left: auto;
  color: #6b7280;
  font-size: 0.75rem;
}

.entry-change {
  margin: 0.75rem 0;
}

.change-values {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.old-value, .new-value {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 0.75rem;
}

.old-value label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #dc2626;
  margin-bottom: 0.5rem;
}

.new-value label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  color: #059669;
  margin-bottom: 0.5rem;
}

.old-value pre, .new-value pre {
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.entry-footer {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: #6b7280;
  padding-top: 0.75rem;
  border-top: 1px solid #e5e7eb;
}

.changed-by, .approved-by {
  font-style: italic;
}
</style>