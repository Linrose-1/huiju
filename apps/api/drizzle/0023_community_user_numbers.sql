-- Pause registration while running this migration. Run preflight before any
-- permanent DDL; MySQL commits each CREATE/ALTER TABLE independently.
CREATE TEMPORARY TABLE `huiju_0023_limits` (
  `failed_check` varchar(48) PRIMARY KEY
) ENGINE=InnoDB;--> statement-breakpoint
INSERT INTO `huiju_0023_limits` VALUES ('community_user_number_capacity');--> statement-breakpoint
INSERT INTO `huiju_0023_limits` SELECT 'community_user_number_capacity'
WHERE (SELECT COUNT(*) FROM `members` WHERE `kind` = 'member') > 999999;--> statement-breakpoint
DROP TEMPORARY TABLE `huiju_0023_limits`;--> statement-breakpoint
CREATE TABLE `communities` (
	`id` varchar(32) NOT NULL,
	`name` varchar(64) NOT NULL,
	`number_prefix` char(2) NOT NULL,
	`last_sequence` int unsigned NOT NULL DEFAULT 0,
	CONSTRAINT `communities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `community_members` (
	`community_id` varchar(32) NOT NULL,
	`member_id` char(36) NOT NULL,
	`sequence_no` int unsigned NOT NULL,
	`user_number` varchar(32) NOT NULL,
	`joined_at` datetime(3) NOT NULL,
	CONSTRAINT `community_members_community_id_member_id_pk` PRIMARY KEY(`community_id`,`member_id`),
	CONSTRAINT `community_members_sequence_uq` UNIQUE(`community_id`,`sequence_no`),
	CONSTRAINT `community_members_number_uq` UNIQUE(`community_id`,`user_number`)
);
--> statement-breakpoint
ALTER TABLE `community_members` ADD CONSTRAINT `community_members_community_id_communities_id_fk` FOREIGN KEY (`community_id`) REFERENCES `communities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `community_members` ADD CONSTRAINT `community_members_member_id_members_id_fk` FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- The last ALTER above implicitly committed the migrator's transaction.
-- This transaction covers the seed, the backfill, and the migrator's ledger insert.
START TRANSACTION;--> statement-breakpoint
INSERT INTO `communities` (`id`, `name`, `number_prefix`, `last_sequence`)
SELECT 'xuejia', '学加社群', 'XJ', COUNT(*) FROM `members` WHERE `kind` = 'member';--> statement-breakpoint
-- created_at is a UTC datetime. Add eight hours only for encoding the local
-- year and month; keep joined_at at its original UTC millisecond precision.
INSERT INTO `community_members` (`community_id`, `member_id`, `sequence_no`, `user_number`, `joined_at`)
SELECT 'xuejia', id, seq,
       CONCAT('XJ',
              SUBSTRING('JABCDEFGHI', MOD(FLOOR(YEAR(local_date) / 10), 10) + 1, 1),
              SUBSTRING('JABCDEFGHI', MOD(YEAR(local_date), 10) + 1, 1),
              SUBSTRING('ABCDEFGHIJKL', MONTH(local_date), 1),
              LPAD(seq, 6, '0')),
       created_at
FROM (
  SELECT id, created_at, DATE_ADD(created_at, INTERVAL 8 HOUR) AS local_date,
         ROW_NUMBER() OVER (ORDER BY created_at, id) AS seq
  FROM `members` WHERE kind = 'member'
) AS ranked;--> statement-breakpoint
UPDATE `members` AS m
JOIN `community_members` AS cm ON cm.member_id = m.id AND cm.community_id = 'xuejia'
SET m.member_number = cm.user_number, m.updated_at = m.updated_at;
