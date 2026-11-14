-- Run through the project migrator with registration and poster-share writers stopped.
-- Temporary tables do not implicitly commit in MySQL. All business updates and
-- Drizzle's journal insert belong to the migrator's single InnoDB transaction.
CREATE TEMPORARY TABLE `huiju_0022_preconditions` (
  `failed_check` varchar(48) PRIMARY KEY
) ENGINE=InnoDB;--> statement-breakpoint
INSERT INTO `huiju_0022_preconditions` VALUES
  ('existing_six_digit_invite_code'), ('more_than_one_million_members');--> statement-breakpoint
-- A failed precondition deliberately hits the named duplicate key before any change.
INSERT INTO `huiju_0022_preconditions` SELECT 'existing_six_digit_invite_code'
WHERE EXISTS (SELECT 1 FROM `members` WHERE `invite_code` REGEXP '^[0-9]{6}$')
   OR EXISTS (SELECT 1 FROM `activity_poster_shares` WHERE `invite_code` REGEXP '^[0-9]{6}$');--> statement-breakpoint
INSERT INTO `huiju_0022_preconditions` SELECT 'more_than_one_million_members'
WHERE (SELECT COUNT(*) FROM `members` WHERE `kind` = 'member') > 1000000;--> statement-breakpoint
CREATE TEMPORARY TABLE `huiju_0022_codes` (
  `member_id` char(36) PRIMARY KEY,
  `code` char(6) NOT NULL UNIQUE
) ENGINE=InnoDB;--> statement-breakpoint
-- 7919 is coprime to 1000000: every six-digit value occurs exactly once
-- before wraparound. Hash ordering decouples assignments from registration order.
INSERT INTO `huiju_0022_codes` (`member_id`, `code`)
SELECT `id`, LPAD(MOD((ROW_NUMBER() OVER (ORDER BY SHA2(`id`, 256), `id`) - 1) * 7919 + 48357, 1000000), 6, '0')
FROM `members` WHERE `kind` = 'member';--> statement-breakpoint
UPDATE `members` AS m JOIN `huiju_0022_codes` AS c ON m.`id` = c.`member_id`
SET m.`invite_code` = c.`code`, m.`updated_at` = m.`updated_at`;--> statement-breakpoint
UPDATE `activity_poster_shares` AS s JOIN `huiju_0022_codes` AS c ON s.`member_id` = c.`member_id`
SET s.`invite_code` = c.`code`;--> statement-breakpoint
DROP TEMPORARY TABLE `huiju_0022_codes`, `huiju_0022_preconditions`;
