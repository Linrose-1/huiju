CREATE TABLE `ai_activity_draft_reservations` (
	`member_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_activity_draft_reservations_member_id` PRIMARY KEY(`member_id`)
);
--> statement-breakpoint
ALTER TABLE `ai_activity_draft_reservations` ADD CONSTRAINT `ai_activity_draft_reservations_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;