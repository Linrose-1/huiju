CREATE TABLE `activity_invite_codes` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`issuer_member_id` char(36) NOT NULL,
	`phone_hash` char(64) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`encrypted_payload` varchar(512) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`used_at` datetime(3),
	`used_by_member_id` char(36),
	`operation_id` char(36),
	CONSTRAINT `activity_invite_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `aic_code_hash_uq` UNIQUE(`code_hash`),
	CONSTRAINT `aic_operation_uq` UNIQUE(`operation_id`),
	CONSTRAINT `aic_usage_ck` CHECK((`activity_invite_codes`.`used_at` IS NULL AND `activity_invite_codes`.`used_by_member_id` IS NULL AND `activity_invite_codes`.`operation_id` IS NULL) OR (`activity_invite_codes`.`used_at` IS NOT NULL AND `activity_invite_codes`.`used_by_member_id` IS NOT NULL AND `activity_invite_codes`.`operation_id` IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE `registrations` ADD `fee_qualification` enum('ordinary','invited_free') DEFAULT 'ordinary' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_invite_codes` ADD CONSTRAINT `aic_activity_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_invite_codes` ADD CONSTRAINT `aic_issuer_fk` FOREIGN KEY (`issuer_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_invite_codes` ADD CONSTRAINT `aic_used_member_fk` FOREIGN KEY (`used_by_member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_invite_codes` ADD CONSTRAINT `aic_operation_fk` FOREIGN KEY (`operation_id`) REFERENCES `registration_operations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `aic_activity_phone_idx` ON `activity_invite_codes` (`activity_id`,`phone_hash`);--> statement-breakpoint
CREATE INDEX `aic_activity_created_idx` ON `activity_invite_codes` (`activity_id`,`created_at`);