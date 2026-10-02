CREATE TABLE `activity_recommendation_conversions` (
	`registration_operation_id` char(36) NOT NULL,
	`view_id` char(36) NOT NULL,
	`search_id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_recommendation_conversions_registration_operation_id` PRIMARY KEY(`registration_operation_id`)
);
--> statement-breakpoint
CREATE TABLE `activity_recommendation_events` (
	`id` char(36) NOT NULL,
	`search_id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`kind` enum('impression','view') NOT NULL,
	`token_hash` char(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_recommendation_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `recommendation_event_once_uq` UNIQUE(`search_id`,`activity_id`,`kind`),
	CONSTRAINT `recommendation_event_token_uq` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `activity_recommendation_reservations` (
	`member_id` char(36) NOT NULL,
	`search_id` char(36) NOT NULL,
	`reservation_id` char(36) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_recommendation_reservations_member_id` PRIMARY KEY(`member_id`)
);
--> statement-breakpoint
CREATE TABLE `activity_recommendation_searches` (
	`id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`request_id` char(36) NOT NULL,
	`input_hash` char(64) NOT NULL,
	`status` enum('pending','results','clarify','failed') NOT NULL,
	`cursor_secret` char(64) NOT NULL,
	`payload` json,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`completed_at` datetime(3),
	`expires_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_recommendation_searches_id` PRIMARY KEY(`id`),
	CONSTRAINT `recommendation_search_request_uq` UNIQUE(`member_id`,`request_id`)
);
--> statement-breakpoint
ALTER TABLE `activity_recommendation_conversions` ADD CONSTRAINT `activity_recommendation_conversions_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_conversions` ADD CONSTRAINT `activity_recommendation_conversions_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_conversions` ADD CONSTRAINT `recommendation_conversion_operation_fk` FOREIGN KEY (`registration_operation_id`) REFERENCES `registration_operations`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_conversions` ADD CONSTRAINT `recommendation_conversion_view_fk` FOREIGN KEY (`view_id`) REFERENCES `activity_recommendation_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_conversions` ADD CONSTRAINT `recommendation_conversion_search_fk` FOREIGN KEY (`search_id`) REFERENCES `activity_recommendation_searches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_events` ADD CONSTRAINT `activity_recommendation_events_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_events` ADD CONSTRAINT `activity_recommendation_events_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_events` ADD CONSTRAINT `recommendation_event_search_fk` FOREIGN KEY (`search_id`) REFERENCES `activity_recommendation_searches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_reservations` ADD CONSTRAINT `activity_recommendation_reservations_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_reservations` ADD CONSTRAINT `recommendation_reservation_search_fk` FOREIGN KEY (`search_id`) REFERENCES `activity_recommendation_searches`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_recommendation_searches` ADD CONSTRAINT `activity_recommendation_searches_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `recommendation_conversion_created_idx` ON `activity_recommendation_conversions` (`created_at`);--> statement-breakpoint
CREATE INDEX `recommendation_event_created_idx` ON `activity_recommendation_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `recommendation_search_usage_idx` ON `activity_recommendation_searches` (`member_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `recommendation_search_created_idx` ON `activity_recommendation_searches` (`created_at`);--> statement-breakpoint
CREATE INDEX `recommendation_search_expiry_idx` ON `activity_recommendation_searches` (`expires_at`);