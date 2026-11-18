<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '../../services/admin'
import { acceptBrand, brandApi, type BrandAppearance } from '../../services/brand'
import { useRequestScope } from '../../services/request-scope'
import BrandImageField from './BrandImageField.vue'
import circleIcon from '../../../../miniapp/src/static/huiju/tab-circle-normal.png'
import activityIcon from '../../../../miniapp/src/static/huiju/tab-activity-normal.png'
import assistantIcon from '../../../../miniapp/src/static/huiju/tab-assistant-normal.png'
import mineIcon from '../../../../miniapp/src/static/huiju/tab-mine-normal.png'

const form = reactive({ displayName: '', visible: true, version: 0 })
const tabs = [
  { key: 'circle', label: '商友圈', icon: circleIcon }, { key: 'activity', label: '友聚会', icon: activityIcon },
  { key: 'assistant', label: 'i 助手', icon: assistantIcon }, { key: 'mine', label: '我世界', icon: mineIcon },
] as const
type Partner = BrandAppearance['partners'][number]
type PartnerDraft = Partner & { key: number }
const logoImageId = ref<string | null>(null)
const tabNames = reactive({ circle: '', activity: '', assistant: '', mine: '' })
const partners = ref<PartnerDraft[]>([])
const uploading = ref(false)
let nextPartnerKey = 0
const loading = ref(false), saving = ref(false), loaded = ref(false), error = ref('')
const disabled = computed(() => !loaded.value || loading.value || saving.value || uploading.value)
const beginLoad = useRequestScope(), beginSave = useRequestScope()

function applyConfiguration(result: typeof form & { appearance?: BrandAppearance }) {
  const { displayName, visible, version, appearance } = result
  Object.assign(form, { displayName, visible, version })
  logoImageId.value = appearance?.logoImageId ?? null
  for (const { key } of tabs) tabNames[key] = appearance?.tabNames[key] ?? ''
  partners.value = (appearance?.partners ?? []).map(partner => ({ ...partner, key: ++nextPartnerKey }))
  acceptBrand(result)
}
function addPartner() {
  if (disabled.value || partners.value.length >= 10) return
  partners.value.push({ key: ++nextPartnerKey, name: '', description: '', logoImageId: null, codeImageId: null,
    sortOrder: Math.min(999, 1 + Math.max(0, ...partners.value.map(partner => partner.sortOrder))), visible: false })
}
function removePartner(partnerKey: number) {
  if (disabled.value) return
  partners.value = partners.value.filter(partner => partner.key !== partnerKey)
}
function appearanceInput(): BrandAppearance {
  return {
    logoImageId: logoImageId.value,
    tabNames: { circle: tabNames.circle.trim(), activity: tabNames.activity.trim(), assistant: tabNames.assistant.trim(), mine: tabNames.mine.trim() },
    partners: partners.value.map(({ name, description, logoImageId, codeImageId, sortOrder, visible }) => ({
      name: name.trim(), description: description.trim(), logoImageId, codeImageId, sortOrder, visible,
    })),
  }
}
async function load() {
  if (loading.value || saving.value || uploading.value) return
  const current = beginLoad()
  loading.value = true
  error.value = ''
  try {
    const result = await brandApi.get()
    if (!current()) return
    applyConfiguration(result)
    loaded.value = true
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) loading.value = false }
}
async function save() {
  if (disabled.value) return
  const displayName = form.displayName.trim()
  if (!displayName || displayName.length > 30) { error.value = '展示名称须为1至30字。'; return }
  const appearance = appearanceInput()
  if (Object.values(appearance.tabNames).some(name => [...name].length > 5)) { error.value = '每个导航名称最多 5 个字符。'; return }
  for (const [index, partner] of appearance.partners.entries()) {
    if (!partner.name || [...partner.name].length > 30) { error.value = `请填写第 ${index + 1} 项合作小程序名称（最多 30 字）。`; return }
    if ([...partner.description].length > 120 || !Number.isInteger(partner.sortOrder) || partner.sortOrder < 0 || partner.sortOrder > 999) {
      error.value = `第 ${index + 1} 项简介最多 120 字，排序须为 0 到 999 的整数。`; return
    }
    if (partner.visible && !partner.codeImageId) { error.value = `请先上传「${partner.name}」的小程序码再开启显示。`; return }
  }
  const current = beginSave()
  saving.value = true
  error.value = ''
  try {
    const result = await brandApi.save({ displayName, visible: form.visible, version: form.version, appearance })
    if (!current()) return
    applyConfiguration(result)
    ElMessage.success('品牌设置已保存')
  } catch (value) { if (current()) error.value = errorMessage(value) }
  finally { if (current()) saving.value = false }
}
onMounted(load)
</script>

<template>
  <section>
    <h1>品牌设置</h1>
    <p class="page-description">
      应用内品牌、底部导航和合作小程序在此配置。微信登记的小程序名称和头像由微信公众平台管理。
    </p>
    <el-alert
      v-if="error"
      class="form-error"
      :title="error"
      type="error"
      :closable="false"
    />
    <div
      v-loading="loading"
      class="brand-settings"
    >
      <el-form
        label-position="top"
        @submit.prevent="save"
      >
        <section class="panel brand-panel">
          <h2>品牌与导航</h2>
          <div class="brand-basics">
            <div>
              <el-form-item label="应用内名称">
                <el-input
                  v-model="form.displayName"
                  :maxlength="30"
                  show-word-limit
                  :disabled="disabled"
                />
              </el-form-item>
              <el-form-item label="展示品牌标识">
                <el-switch
                  v-model="form.visible"
                  :disabled="disabled"
                />
              </el-form-item>
            </div>
            <BrandImageField
              v-model="logoImageId"
              label="品牌 Logo"
              purpose="logo"
              :disabled="disabled"
              @busy="uploading = $event"
            />
          </div>
          <div class="navigation-title">
            <h3>底部导航名称</h3>
            <p class="muted">
              只修改名称，图标和顺序不变。留空使用默认名称。
            </p>
          </div>
          <div class="tab-fields">
            <el-form-item
              v-for="tab in tabs"
              :key="tab.key"
              :label="tab.label"
            >
              <div class="tab-field">
                <img
                  :src="tab.icon"
                  alt=""
                  class="tab-icon"
                >
                <el-input
                  v-model="tabNames[tab.key]"
                  :placeholder="tab.label"
                  :maxlength="5"
                  :disabled="disabled"
                />
              </div>
            </el-form-item>
          </div>
        </section>

        <section class="panel brand-panel">
          <div class="navigation-title">
            <h2>合作小程序</h2>
            <el-button
              :disabled="disabled || partners.length >= 10"
              @click="addPartner"
            >
              添加合作小程序
            </el-button>
          </div>
          <p class="muted">
            启用后展示在「我世界 → 合作小程序」。无启用项时隐藏入口。序号越小越靠前。
          </p>
          <el-empty
            v-if="!partners.length"
            description="尚未配置合作小程序"
            :image-size="56"
          />
          <div
            v-for="(partner, index) in partners"
            :key="partner.key"
            class="partner-card"
          >
            <div class="navigation-title">
              <h3>合作小程序 {{ index + 1 }}</h3>
              <el-button
                link
                type="danger"
                :disabled="disabled"
                @click="removePartner(partner.key)"
              >
                移除此项
              </el-button>
            </div>
            <div class="partner-settings">
              <div>
                <el-form-item label="名称">
                  <el-input
                    v-model="partner.name"
                    :maxlength="30"
                    :disabled="disabled"
                  />
                </el-form-item>
                <el-form-item label="简短介绍">
                  <el-input
                    v-model="partner.description"
                    :maxlength="120"
                    type="textarea"
                    :rows="2"
                    :disabled="disabled"
                  />
                </el-form-item>
                <div class="partner-options">
                  <el-form-item label="排序">
                    <el-input-number
                      v-model="partner.sortOrder"
                      :min="0"
                      :max="999"
                      :precision="0"
                      :disabled="disabled"
                    />
                  </el-form-item>
                  <el-form-item label="显示">
                    <el-switch
                      v-model="partner.visible"
                      :disabled="disabled || (!partner.visible && !partner.codeImageId)"
                    />
                  </el-form-item>
                </div>
              </div>
              <div class="partner-media">
                <BrandImageField
                  v-model="partner.codeImageId"
                  label="小程序码"
                  purpose="code"
                  :disabled="disabled"
                  @busy="uploading = $event"
                />
                <BrandImageField
                  v-model="partner.logoImageId"
                  label="合作方 Logo（选填）"
                  purpose="logo"
                  :disabled="disabled"
                  @busy="uploading = $event"
                />
              </div>
            </div>
          </div>
        </section>
        <div class="actions brand-actions">
          <el-button
            type="primary"
            native-type="submit"
            :loading="saving"
            :disabled="disabled"
          >
            保存配置
          </el-button>
          <el-button
            :disabled="loading || saving || uploading"
            @click="load"
          >
            {{ loaded ? '重新读取' : '重试加载' }}
          </el-button>
        </div>
      </el-form>
    </div>
  </section>
</template>

<style scoped>
.brand-settings { max-width: 960px; }
.brand-panel { margin-bottom:16px; }
h2 { font-size:18px; margin:0 0 16px; }
h3 { font-size:15px; margin:0; }
.brand-basics,.partner-settings { display:grid; grid-template-columns:minmax(240px,1fr) minmax(240px,1fr); gap:24px; }
.brand-basics { padding-bottom:12px; margin-bottom:16px; border-bottom:1px solid var(--huiju-border); }
.navigation-title { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.navigation-title h2,.navigation-title p { margin:0; }
.tab-fields { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
.tab-field { display:flex; align-items:center; gap:8px; width:100%; }
.tab-icon { flex:none; width:22px; height:22px; object-fit:contain; }
.partner-card { padding:16px; margin-top:12px; border-radius:8px; border:1px solid var(--huiju-border); }
.partner-options { display:flex; flex-wrap:wrap; gap:16px; }
.partner-media { display:grid; gap:12px; align-content:start; }
.brand-actions { justify-content:flex-end; }
@media (max-width:810px) { .brand-basics,.partner-settings { grid-template-columns:1fr; } .tab-fields { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
