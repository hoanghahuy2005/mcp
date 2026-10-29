-- ///////////////////////////////////////////////////////////
-- // PROJECTOR                                             //
-- //-------------------------------------------------------//
-- // Version : 13.1.1                                      //
-- // Date : 2026-09-15                                     //
-- ///////////////////////////////////////////////////////////
-- Patch on V13.1

-- ============================================================
-- Prospect : phone et mobile passent a 30 caracteres
-- ============================================================
ALTER TABLE `${prefix}prospect` CHANGE `phone` `phone` varchar(30) DEFAULT NULL;
ALTER TABLE `${prefix}prospect` CHANGE `mobile` `mobile` varchar(30) DEFAULT NULL;
-- fin Prospect : phone et mobile

-- ============================================================
-- Resource : phone et mobile passent a 30 caracteres
-- ============================================================
ALTER TABLE `${prefix}resource` CHANGE `phone` `phone` varchar(30) DEFAULT NULL;
ALTER TABLE `${prefix}resource` CHANGE `mobile` `mobile` varchar(30) DEFAULT NULL;
-- fin Resource : phone et mobile

-- ============================================================
-- Prospect : date de creation, reprise de l'historique et de son archive
-- ============================================================
ALTER TABLE `${prefix}prospect` ADD `creationDateTime` datetime DEFAULT NULL;
UPDATE `${prefix}prospect` p SET creationDateTime = (SELECT MIN(h.operationDate) FROM `${prefix}history` h WHERE h.refType='Prospect' AND h.refId=p.id AND h.operation='insert' AND h.colName IS NULL) WHERE p.creationDateTime IS NULL;
UPDATE `${prefix}prospect` p SET creationDateTime = (SELECT MIN(a.operationDate) FROM `${prefix}historyarchive` a WHERE a.refType='Prospect' AND a.refId=p.id AND a.operation='insert' AND a.colName IS NULL) WHERE p.creationDateTime IS NULL;
-- fin Prospect : date de creation


-- Report for CRM
INSERT INTO `${prefix}report` (`id`, `name`, `idReportCategory`, `file`, `sortOrder`, `idle`, `orientation`, `hasCsv`, `hasView`, `hasPrint`, `hasPdf`, `hasToday`, `hasFavorite`, `hasWord`, `hasExcel`, `filterClass`, `referTo`) VALUES
(149, 'reportCRM', 10, 'prospectByEngagementReport.php', 1080, 0, 'L', 0, 1, 1, 1, 1, 1, 0, 0, NULL, NULL);

INSERT INTO `${prefix}habilitationreport` (`idProfile`, `idReport`, `allowAccess`) VALUES
(1, 149, 1),
(2, 149, 1),
(3, 149, 0),
(4, 149, 0),
(5, 149, 0),
(6, 149, 0),
(7, 149, 0);


-- Client missing engagement field
ALTER TABLE `${prefix}client` ADD COLUMN `idEngagement` int(12) unsigned DEFAULT NULL COMMENT '12';