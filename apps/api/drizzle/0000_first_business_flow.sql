CREATE TABLE `activities` (
	`id` char(36) NOT NULL,
	`organizer_member_id` char(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`cover_url` varchar(2048),
	`location` varchar(500) NOT NULL,
	`consultation_contact` text NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`registration_deadline` datetime(3),
	`capacity` int unsigned,
	`active_registration_count` int unsigned NOT NULL DEFAULT 0,
	`cancellation_registration_count` int unsigned,
	`has_registration_ever` boolean NOT NULL DEFAULT false,
	`fee_type` enum('free','paid') NOT NULL,
	`fee_amount_cents` int unsigned,
	`lifecycle` enum('draft','published','cancelled') NOT NULL DEFAULT 'draft',
	`moderation` enum('normal','removed') NOT NULL DEFAULT 'normal',
	`published_at` datetime(3),
	`cancelled_at` datetime(3),
	`cancellation_reason` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `activities_time_order_ck` CHECK(`activities`.`ends_at` > `activities`.`starts_at`),
	CONSTRAINT `activities_registration_deadline_ck` CHECK(`activities`.`registration_deadline` is null or `activities`.`registration_deadline` <= `activities`.`starts_at`),
	CONSTRAINT `activities_capacity_ck` CHECK(`activities`.`capacity` is null or `activities`.`capacity` > 0),
	CONSTRAINT `activities_active_count_ck` CHECK(`activities`.`active_registration_count` >= 0 and (`activities`.`capacity` is null or `activities`.`active_registration_count` <= `activities`.`capacity`)),
	CONSTRAINT `activities_fee_ck` CHECK((`activities`.`fee_type` = 'free' and `activities`.`fee_amount_cents` is null) or (`activities`.`fee_type` = 'paid' and `activities`.`fee_amount_cents` is not null and `activities`.`fee_amount_cents` > 0)),
	CONSTRAINT `activities_cancellation_ck` CHECK((`activities`.`lifecycle` = 'cancelled' and `activities`.`cancelled_at` is not null and `activities`.`cancellation_reason` is not null and `activities`.`cancellation_registration_count` is not null) or (`activities`.`lifecycle` <> 'cancelled' and `activities`.`cancellation_registration_count` is null))
);
--> statement-breakpoint
CREATE TABLE `activity_operations` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`actor_type` enum('member','admin') NOT NULL,
	`actor_member_id` char(36),
	`actor_admin_account_id` char(36),
	`action` enum('publish','cancel','remove','restore','update_consultation_contact') NOT NULL,
	`reason` text,
	`change_summary` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_operations_id` PRIMARY KEY(`id`),
	CONSTRAINT `activity_operations_actor_ck` CHECK((`activity_operations`.`actor_type` = 'member' and `activity_operations`.`actor_member_id` is not null and `activity_operations`.`actor_admin_account_id` is null) or (`activity_operations`.`actor_type` = 'admin' and `activity_operations`.`actor_admin_account_id` is not null and `activity_operations`.`actor_member_id` is null)),
	CONSTRAINT `activity_operations_reason_ck` CHECK(`activity_operations`.`action` not in ('cancel', 'remove', 'restore') or `activity_operations`.`reason` is not null)
);
--> statement-breakpoint
CREATE TABLE `registration_questions` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`type` enum('short_text','long_text','single','multiple') NOT NULL,
	`prompt` text NOT NULL,
	`required` boolean NOT NULL DEFAULT false,
	`sort_order` int unsigned NOT NULL,
	`options` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `registration_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_accounts` (
	`id` char(36) NOT NULL,
	`display_name` varchar(100) NOT NULL,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_accounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`id` char(36) NOT NULL,
	`admin_account_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_sessions_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `member_sessions` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`token_hash` char(64) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `member_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `member_sessions_token_hash_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `member_visibilities` (
	`member_id` char(36) NOT NULL,
	`show_real_name` boolean NOT NULL DEFAULT false,
	`show_email` boolean NOT NULL DEFAULT false,
	`show_bound_phone` boolean NOT NULL DEFAULT false,
	`show_hometown` boolean NOT NULL DEFAULT false,
	`show_resources` boolean NOT NULL DEFAULT false,
	`show_needs` boolean NOT NULL DEFAULT false,
	`show_bio` boolean NOT NULL DEFAULT false,
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `member_visibilities_member_id` PRIMARY KEY(`member_id`)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` char(36) NOT NULL,
	`kind` enum('member','platform_root') NOT NULL DEFAULT 'member',
	`member_number` varchar(32) NOT NULL,
	`invite_code` varchar(32) NOT NULL,
	`inviter_member_id` char(36),
	`avatar_url` varchar(2048),
	`display_name` varchar(100),
	`avatar_set_by_user` boolean NOT NULL DEFAULT false,
	`name_set_by_user` boolean NOT NULL DEFAULT false,
	`bound_phone` varchar(32),
	`real_name` varchar(100),
	`email` varchar(320),
	`hometown` varchar(100),
	`resources` text,
	`needs` text,
	`bio` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `members_id` PRIMARY KEY(`id`),
	CONSTRAINT `members_member_number_uq` UNIQUE(`member_number`),
	CONSTRAINT `members_invite_code_uq` UNIQUE(`invite_code`),
	CONSTRAINT `members_inviter_ck` CHECK((`members`.`kind` = 'platform_root' and `members`.`inviter_member_id` is null) or (`members`.`kind` = 'member' and `members`.`inviter_member_id` is not null))
);
--> statement-breakpoint
CREATE TABLE `wechat_identities` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`app_id` varchar(64) NOT NULL,
	`open_id` varchar(128) NOT NULL,
	`union_id` varchar(128),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `wechat_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `wechat_identities_member_id_uq` UNIQUE(`member_id`),
	CONSTRAINT `wechat_identities_app_id_open_id_uq` UNIQUE(`app_id`,`open_id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` char(36) NOT NULL,
	`recipient_member_id` char(36) NOT NULL,
	`activity_id` char(36),
	`type` enum('activity_cancelled','activity_removed','activity_restored','consultation_contact_updated') NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` text NOT NULL,
	`read_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `registration_answers` (
	`id` char(36) NOT NULL,
	`registration_id` char(36) NOT NULL,
	`question_id` char(36) NOT NULL,
	`answer` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `registration_answers_id` PRIMARY KEY(`id`),
	CONSTRAINT `registration_answers_registration_question_uq` UNIQUE(`registration_id`,`question_id`)
);
--> statement-breakpoint
CREATE TABLE `registration_operations` (
	`id` char(36) NOT NULL,
	`registration_id` char(36) NOT NULL,
	`actor_member_id` char(36) NOT NULL,
	`action` enum('registered','cancelled','reregistered') NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `registration_operations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `registrations` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`status` enum('active','cancelled') NOT NULL DEFAULT 'active',
	`contact_phone` varchar(32) NOT NULL,
	`first_registered_at` datetime(3) NOT NULL,
	`current_registered_at` datetime(3) NOT NULL,
	`cancelled_at` datetime(3),
	`attended` boolean NOT NULL DEFAULT false,
	`attended_at` datetime(3),
	`attendance_marked_by_member_id` char(36),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `registrations_id` PRIMARY KEY(`id`),
	CONSTRAINT `registrations_activity_member_uq` UNIQUE(`activity_id`,`member_id`),
	CONSTRAINT `registrations_status_ck` CHECK((`registrations`.`status` = 'active' and `registrations`.`cancelled_at` is null) or (`registrations`.`status` = 'cancelled' and `registrations`.`cancelled_at` is not null)),
	CONSTRAINT `registrations_attendance_ck` CHECK((`registrations`.`attended` = false and `registrations`.`attended_at` is null and `registrations`.`attendance_marked_by_member_id` is null) or (`registrations`.`attended` = true and `registrations`.`attended_at` is not null and `registrations`.`attendance_marked_by_member_id` is not null))
);
--> statement-breakpoint
ALTER TABLE `activities` ADD CONSTRAINT `activities_organizer_member_id_members_id_fk` FOREIGN KEY (`organizer_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_operations` ADD CONSTRAINT `activity_operations_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_operations` ADD CONSTRAINT `activity_operations_actor_member_id_members_id_fk` FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_operations` ADD CONSTRAINT `activity_operations_actor_admin_account_id_admin_accounts_id_fk` FOREIGN KEY (`actor_admin_account_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registration_questions` ADD CONSTRAINT `registration_questions_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_account_id_admin_accounts_id_fk` FOREIGN KEY (`admin_account_id`) REFERENCES `admin_accounts`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `member_sessions` ADD CONSTRAINT `member_sessions_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `member_visibilities` ADD CONSTRAINT `member_visibilities_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `members` ADD CONSTRAINT `members_inviter_member_id_members_id_fk` FOREIGN KEY (`inviter_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `wechat_identities` ADD CONSTRAINT `wechat_identities_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_recipient_member_id_members_id_fk` FOREIGN KEY (`recipient_member_id`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registration_answers` ADD CONSTRAINT `registration_answers_registration_id_registrations_id_fk` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registration_answers` ADD CONSTRAINT `registration_answers_question_id_registration_questions_id_fk` FOREIGN KEY (`question_id`) REFERENCES `registration_questions`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registration_operations` ADD CONSTRAINT `registration_operations_registration_id_registrations_id_fk` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registration_operations` ADD CONSTRAINT `registration_operations_actor_member_id_members_id_fk` FOREIGN KEY (`actor_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_attendance_marked_by_member_id_members_id_fk` FOREIGN KEY (`attendance_marked_by_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `activities_organizer_member_id_idx` ON `activities` (`organizer_member_id`);--> statement-breakpoint
CREATE INDEX `activities_public_list_idx` ON `activities` (`lifecycle`,`moderation`,`starts_at`);--> statement-breakpoint
CREATE INDEX `activity_operations_activity_created_at_idx` ON `activity_operations` (`activity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `registration_questions_activity_sort_idx` ON `registration_questions` (`activity_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `admin_sessions_account_id_expires_at_idx` ON `admin_sessions` (`admin_account_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `member_sessions_member_id_expires_at_idx` ON `member_sessions` (`member_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `members_inviter_member_id_idx` ON `members` (`inviter_member_id`);--> statement-breakpoint
CREATE INDEX `wechat_identities_union_id_idx` ON `wechat_identities` (`union_id`);--> statement-breakpoint
CREATE INDEX `notifications_recipient_read_created_idx` ON `notifications` (`recipient_member_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_activity_id_idx` ON `notifications` (`activity_id`);--> statement-breakpoint
CREATE INDEX `registration_operations_registration_created_at_idx` ON `registration_operations` (`registration_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `registrations_activity_status_idx` ON `registrations` (`activity_id`,`status`);--> statement-breakpoint
CREATE INDEX `registrations_member_status_idx` ON `registrations` (`member_id`,`status`);