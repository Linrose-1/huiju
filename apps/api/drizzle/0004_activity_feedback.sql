CREATE TABLE `activity_comments` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`content` text NOT NULL,
	`hidden_at` datetime(3),
	`deleted_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `activity_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `activity_reviews` (
	`id` char(36) NOT NULL,
	`activity_id` char(36) NOT NULL,
	`member_id` char(36) NOT NULL,
	`content` text NOT NULL,
	`hidden_at` datetime(3),
	`deleted_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`score` int NOT NULL,
	CONSTRAINT `activity_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `activity_reviews_activity_member_uq` UNIQUE(`activity_id`,`member_id`),
	CONSTRAINT `activity_reviews_score_ck` CHECK(`activity_reviews`.`score` between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE `activity_comments` ADD CONSTRAINT `activity_comments_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_comments` ADD CONSTRAINT `activity_comments_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_reviews` ADD CONSTRAINT `activity_reviews_activity_id_activities_id_fk` FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE `activity_reviews` ADD CONSTRAINT `activity_reviews_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX `activity_comments_activity_created_idx` ON `activity_comments` (`activity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_comments_member_activity_idx` ON `activity_comments` (`member_id`,`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_reviews_activity_created_idx` ON `activity_reviews` (`activity_id`,`created_at`);