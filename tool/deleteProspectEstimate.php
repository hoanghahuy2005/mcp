<?php
/*** COPYRIGHT NOTICE *********************************************************
 *
 * Copyright 2009-2017 ProjeQtOr - Pascal BERNARD - support@projeqtor.org
 * Contributors : -
 *
 * This file is part of ProjeQtOr.
 * 
 * ProjeQtOr is free software: you can redistribute it and/or modify it under 
 * the terms of the GNU Affero General Public License as published by the Free 
 * Software Foundation, either version 3 of the License, or (at your option) 
 * any later version.
 * 
 * ProjeQtOr is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS 
 * FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for 
 * more details.
 *
 * You should have received a copy of the GNU Affero General Public License along with
 * ProjeQtOr. If not, see <http://www.gnu.org/licenses/>.
 *
 * You can get complete code of ProjeQtOr, other resource, help and information
 * about contributors at http://www.projeqtor.org 
 *     
 *** DO NOT REMOVE THIS NOTICE ************************************************/

/** ===========================================================================
 * Delete a prospect estimate from the list of its prospect.
 * Called without posting a form : the prospect record form carries
 * objectClassName=Prospect, which would take precedence over the request.
 */
require_once "../tool/projeqtor.php";
scriptLog('   ->/tool/deleteProspectEstimate.php');

$estimateId=RequestHandler::getId('prospectEstimateId', true);
$obj=new ProspectEstimate($estimateId); // numeric id checked by the SqlElement constructor
if (!$obj->id) {
  throwError('prospect estimate #'.$estimateId.' not found');
}
Security::checkValidAccessForUser($obj, 'delete');

Sql::beginTransaction();
$result=$obj->delete();
displayLastOperationStatus($result);
?>
