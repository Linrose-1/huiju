import { createRouter, createWebHistory } from 'vue-router'
import { allowedRoute } from '../services/access'
import { session } from '../services/admin'
import LoginPage from '../modules/auth/LoginPage.vue'
import PasswordPage from '../modules/auth/PasswordPage.vue'
import AccountsPage from '../modules/accounts/AccountsPage.vue'
import MembersPage from '../modules/members/MembersPage.vue'
import FeedbackPage from '../modules/feedback/FeedbackPage.vue'
import AnalyticsPage from '../modules/analytics/AnalyticsPage.vue'
import EngagementPage from '../modules/analytics/EngagementPage.vue'
import ContentPage from '../modules/content/ContentPage.vue'
import ActivitiesPage from '../modules/activities/ActivitiesPage.vue'
import ActivityDetailPage from '../modules/activities/ActivityDetailPage.vue'
import ActivityRegistrationsPage from '../modules/activities/ActivityRegistrationsPage.vue'
import CirclePage from '../modules/circle/CirclePage.vue'
import AdvertisingPage from '../modules/advertising/AdvertisingPage.vue'
import BrandPage from '../modules/brand/BrandPage.vue'
import McpSettingsPage from '../modules/mcp/McpSettingsPage.vue'

export { allowedRoute } from '../services/access'

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, from, savedPosition) {
    if (to.path !== from.path && to.matched.some(record => record.meta.activityPage)) return savedPosition ?? { top: 0 }
  },
  routes: [
    { path: '/analytics', component: AnalyticsPage },
    { path: '/engagement', component: EngagementPage },
    { path: '/content', component: ContentPage },
    { path: '/advertising', component: AdvertisingPage },
    { path: '/brand', component: BrandPage },
    { path: '/mcp-settings', component: McpSettingsPage },
    { path: '/login', component: LoginPage },
    { path: '/password', component: PasswordPage },
    { path: '/feedback', component: FeedbackPage },
    { path: '/activities', name: 'activity-list', component: ActivitiesPage, meta: { activityPage: true } },
    { path: '/activities/:id', name: 'activity-detail', component: ActivityDetailPage, meta: { activityPage: true, title: '活动详情' } },
    { path: '/activities/:id/registrations', name: 'activity-registrations', component: ActivityRegistrationsPage, meta: { activityPage: true, title: '报名名单' } },
    { path: '/circle', component: CirclePage },
    { path: '/members', component: MembersPage },
    { path: '/accounts', component: AccountsPage },
    { path: '/:pathMatch(.*)*', redirect: '/analytics' },
  ],
})
// App keeps business views hidden until the initial cookie check completes.
router.beforeEach((to) => session.initialized ? allowedRoute(to.path) : undefined)
