import { Injectable } from '@nestjs/common'
import { createDatabase } from './db.js'
import { fail } from '../common/errors.js'

@Injectable()
export class FlowDatabase {
  private connection?: ReturnType<typeof createDatabase>

  get db() {
    if (!process.env.DATABASE_URL) {
      fail('SERVICE_UNAVAILABLE', '数据库尚未配置', 503)
    }
    this.connection ??= createDatabase(process.env.DATABASE_URL)
    return this.connection.db
  }

  async onModuleDestroy() { await this.connection?.pool.end() }
}
