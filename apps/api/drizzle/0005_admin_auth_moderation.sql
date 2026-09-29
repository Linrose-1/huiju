CREATE TABLE `admin_account_audit` (
	`id` char(36) NOT NULL,
	`actor_id` char(36),
	`target_id` char(36) NOT NULL,
	`action` enum('create','reset_password','change_password','disable','enable','bootstrap','recover') NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `admin_account_audit_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `admin_credentials` (
	`admin_account_id` char(36) NOT NULL,
	`username` varchar(64) NOT NULL,
	`role` enum('super_admin','operator') NOT NULL DEFAULT 'operator',
	`password_hash` varchar(256) NOT NULL,
	`must_change_password` boolean NOT NULL DEFAULT true,
	`failed_attempts` int unsigned NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	CONSTRAINT `admin_credentials_admin_account_id` PRIMARY KEY(`admin_account_id`),
	CONSTRAINT `admin_credentials_username_uq` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `feedback_moderation_logs` (
	`id` char(36) NOT NULL,
	`kind` enum('comment','review') NOT NULL,
	`target_id` char(36) NOT NULL,
	`admin_id` char(36) NOT NULL,
	`admin_name` varchar(100) NOT NULL,
	`reason` varchar(500) NOT NULL,
	`content_snapshot` text NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `feedback_moderation_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `feedback_moderation_target_uq` UNIQUE(`kind`,`target_id`)
);
--> statement-breakpoint
ALTER TABLE `admin_account_audit` ADD CONSTRAINT `admin_account_audit_actor_id_admin_accounts_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_account_audit` ADD CONSTRAINT `admin_account_audit_target_id_admin_accounts_id_fk` FOREIGN KEY (`target_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `admin_credentials` ADD CONSTRAINT `admin_credentials_admin_account_id_admin_accounts_id_fk` FOREIGN KEY (`admin_account_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback_moderation_logs` ADD CONSTRAINT `feedback_moderation_logs_admin_id_admin_accounts_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `admin_accounts`(`id`) ON DELETE restrict ON UPDATE restrict;