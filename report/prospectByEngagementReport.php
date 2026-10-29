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

/* ============================================================================
 * Prospects by Engagement : one line per Engagement, with the number of
 * prospects currently on that engagement, and where that count stood at the
 * end of the two previous months, plus how many converted (got a Client link)
 * each month, plus the untaxed amount quoted and ordered that month by the
 * clients that came from a prospect, and a 12 month trend curve for the two
 * hottest engagements (matched by name : "Bouillant" and "Chaud" ; falls back
 * to the two lowest-sortOrder engagements if those names don't exist)
 * alongside the conversions.
 *
 * Prospect itself carries no creation/update/conversion date : those are read
 * from the history table (and historyarchive, in case cronArchiveCloseItems
 * moved a since-archived prospect's trace there) to rebuild, for each
 * prospect, what its idEngagement/idle looked like at a past date, and when
 * it first got linked to a Client. That same history also tells us which
 * Client ids came from a prospect, to scope the Command amounts.
 *
 * Two more columns on the Engagement table itself : the untaxed amount of
 * every ProspectEstimate (the quotation issued to a prospect, before any
 * Client exists) currently held by that engagement's active prospects
 * ("total"), and that same amount weighted by each estimate's
 * Likelihood.valuePct ("possible").
 */

include_once '../tool/projeqtor.php';
include_once("../external/pChart2/class/pData.class.php");
include_once("../external/pChart2/class/pDraw.class.php");
include_once("../external/pChart2/class/pImage.class.php");

/**
 * Value of a tracked column for one object, as it stood on $snapshotDate.
 * $changes is the list of history rows for that column, oldest first :
 * {operationDate, oldValue, newValue}. Walking it backwards from the most
 * recent change, each change dated after the snapshot is undone (the value
 * reverts to its oldValue) until one dated at or before the snapshot is met,
 * or the list is exhausted (value at creation time).
 */
function prospectHistoryValueAsOf($changes, $currentValue, $snapshotDate) {
  $value=$currentValue;
  for ($i=count($changes)-1; $i>=0; $i--) {
    if ($changes[$i]['operationDate']>$snapshotDate) {
      $value=$changes[$i]['oldValue'];
    } else {
      break;
    }
  }
  return $value;
}

$headerParameters='';
include "header.php";

// ---- 12 monthly snapshots, oldest (M-11) to newest (M, now) ----------------
$monthNamesFull=getArrayMonth(null);
$monthNamesShort=getArrayMonth(4,true);
$monthNow=intval(date('n'));
$yearNow=intval(date('Y'));
$nbMonths=12;
$months=array();
for ($back=$nbMonths-1; $back>=0; $back--) {
  $m=$monthNow-$back;
  $y=$yearNow;
  while ($m<1) { $m+=12; $y--; }
  if ($back==0) {
    $date=null; // current month : use the live value, not a reconstructed one
  } else {
    $mPadded=($m<10)?"0$m":"$m";
    $date="$y-$mPadded-" . lastDayOfMonth($m,$y) . " 23:59:59";
  }
  $months[]=array(
    'date'       => $date,
    'year'       => $y,
    'month'      => $m,
    'label'      => $monthNamesFull[$m-1] . ' ' . $y,
    'shortLabel' => $monthNamesShort[$m-1] . ' ' . sprintf('%02d', $y % 100),
  );
}
$monthIndexByYearMonth=array();
foreach ($months as $mIndex=>$month) { $monthIndexByYearMonth[$month['year'] . '-' . $month['month']]=$mIndex; }
$nbTableMonths=3; // the table only shows the last 3 (M-2, M-1, M)

// ---- engagements, in display order -----------------------------------------
$engagements=array();
$q=Sql::query("SELECT id, name, sortOrder, idle, color FROM engagement ORDER BY sortOrder, id");
while ($r=Sql::fetchLine($q)) { $engagements[intval($r['id'])]=$r; }

// ---- every prospect, whatever its current status : a past snapshot may need
//      one that is idle (or gone) today ----------------------------------
$prospects=array();
$q=Sql::query("SELECT id, idEngagement, idle FROM prospect");
while ($r=Sql::fetchLine($q)) { $prospects[intval($r['id'])]=$r; }

if (checkNoData($prospects)) { if (!empty($cronnedScript)) goto end; else exit; }

// ---- history : creation date, every idEngagement/idle change, and every
//      Link created between the prospect and a Client (its "conversion") ----
// A Link creation is stored on the Prospect's own history as an 'insert' row
// whose colName looks like "Link||Client|<clientId>" (see History::store,
// the refType=='Link' branch), whichever side of the link the prospect was.
$creationDate=array();
$engagementChanges=array();
$idleChanges=array();
$conversionDate=array(); // prospectId => date of its first Client link
$prospectClientIds=array(); // every Client id ever linked from a prospect
$idsIn='(' . implode(',', array_map('intval', array_keys($prospects))) . ')';
$histCommon=" WHERE refType='Prospect' AND refId IN $idsIn"
          . " AND ((operation='insert' AND (colName IS NULL OR colName LIKE 'Link|%|Client|%')) OR colName IN ('idEngagement','idle'))";
$q=Sql::query("SELECT refId, operation, colName, oldValue, newValue, operationDate FROM history" . $histCommon
            . " UNION ALL"
            . " SELECT refId, operation, colName, oldValue, newValue, operationDate FROM historyarchive" . $histCommon
            . " ORDER BY refId, operationDate ASC");
while ($r=Sql::fetchLine($q)) {
  $id=intval($r['refId']);
  if ($r['operation']=='insert') {
    if ($r['colName']) {
      if (!isset($conversionDate[$id]) or $r['operationDate']<$conversionDate[$id]) $conversionDate[$id]=$r['operationDate'];
      $linkParts=pq_explode('|', $r['colName']);
      $clientId=intval(end($linkParts));
      if ($clientId) $prospectClientIds[$clientId]=$clientId;
    } else if (!isset($creationDate[$id])) {
      $creationDate[$id]=$r['operationDate'];
    }
  } else if ($r['colName']=='idEngagement') {
    $engagementChanges[$id][]=array('operationDate'=>$r['operationDate'], 'oldValue'=>$r['oldValue'], 'newValue'=>$r['newValue']);
  } else if ($r['colName']=='idle') {
    $idleChanges[$id][]=array('operationDate'=>$r['operationDate'], 'oldValue'=>$r['oldValue'], 'newValue'=>$r['newValue']);
  }
}

// ---- converted prospects per month : one count per prospect, on the month
//      of its earliest Client link, however many links it since gathered ---
$convertedCounts=array_fill(0, $nbMonths, 0);
foreach ($conversionDate as $id=>$date) {
  $ym=intval(pq_substr($date,0,4)) . '-' . intval(pq_substr($date,5,2));
  if (isset($monthIndexByYearMonth[$ym])) $convertedCounts[$monthIndexByYearMonth[$ym]]+=1;
}

// ---- untaxed amount quoted and ordered per month, on the clients that came
//      from a prospect. Quotation is bucketed on its creationDate (when it
//      was generated ; sendDate is often left empty), Command on its
//      receptionDate, the field the Prospection view already sorts it by ----
$quotedAmounts=array_fill(0, $nbMonths, 0);
$orderedAmounts=array_fill(0, $nbMonths, 0);
if (count($prospectClientIds)) {
  $clientIdsIn='(' . implode(',', $prospectClientIds) . ')';
  $q=Sql::query("SELECT untaxedAmount, creationDate FROM quotation WHERE idClient IN $clientIdsIn AND creationDate IS NOT NULL");
  while ($r=Sql::fetchLine($q)) {
    $ym=intval(pq_substr($r['creationDate'],0,4)) . '-' . intval(pq_substr($r['creationDate'],5,2));
    if (isset($monthIndexByYearMonth[$ym])) $quotedAmounts[$monthIndexByYearMonth[$ym]]+=floatval($r['untaxedAmount']);
  }
  $q=Sql::query("SELECT untaxedAmount, receptionDate FROM command WHERE idClient IN $clientIdsIn AND receptionDate IS NOT NULL");
  while ($r=Sql::fetchLine($q)) {
    $ym=intval(pq_substr($r['receptionDate'],0,4)) . '-' . intval(pq_substr($r['receptionDate'],5,2));
    if (isset($monthIndexByYearMonth[$ym])) $orderedAmounts[$monthIndexByYearMonth[$ym]]+=floatval($r['untaxedAmount']);
  }
}

// ---- count prospects per engagement, once per monthly snapshot -------------
// Key 0 gathers prospects with no engagement set, as an "undefined" line.
$counts=array();
foreach ($months as $mIndex=>$month) {
  $snapshotDate=$month['date'];
  foreach ($prospects as $id=>$p) {
    if ($snapshotDate===null) {
      $idle=$p['idle'];
      $idEngagement=$p['idEngagement'];
    } else {
      $created=isset($creationDate[$id]) ? $creationDate[$id] : '1970-01-01 00:00:00';
      if ($created>$snapshotDate) continue; // did not exist yet at that date
      $idle=prospectHistoryValueAsOf(isset($idleChanges[$id]) ? $idleChanges[$id] : array(), $p['idle'], $snapshotDate);
      $idEngagement=prospectHistoryValueAsOf(isset($engagementChanges[$id]) ? $engagementChanges[$id] : array(), $p['idEngagement'], $snapshotDate);
    }
    if (intval($idle)==1) continue; // archived / inactive as of that date
    $key=$idEngagement ? intval($idEngagement) : 0;
    if (!isset($counts[$key])) $counts[$key]=array_fill(0, $nbMonths, 0);
    $counts[$key][$mIndex]+=1;
  }
}

// ---- ProspectEstimate (the quotations issued directly to a prospect, before
//      any client exists) : untaxed amount per engagement, currently held by
//      that engagement's active prospects. "possible" weighs each estimate by
//      its Likelihood.valuePct (0 when no likelihood is set) --------------
$likelihoodPct=array();
$q=Sql::query("SELECT id, valuePct FROM likelihood");
while ($r=Sql::fetchLine($q)) { $likelihoodPct[intval($r['id'])]=floatval($r['valuePct']); }

$currentEngagementOfProspect=array();
foreach ($prospects as $id=>$p) {
  if (intval($p['idle'])==1) continue;
  $currentEngagementOfProspect[$id]=$p['idEngagement'] ? intval($p['idEngagement']) : 0;
}

$estimateTotal=array();
$estimatePossible=array();
$q=Sql::query("SELECT idProspect, untaxedAmount, idLikelihood FROM prospectestimate WHERE idProspect IN $idsIn AND cancelled=0");
while ($r=Sql::fetchLine($q)) {
  $pid=intval($r['idProspect']);
  if (!isset($currentEngagementOfProspect[$pid])) continue; // prospect no longer active
  $key=$currentEngagementOfProspect[$pid];
  $amount=floatval($r['untaxedAmount']);
  $pct=isset($likelihoodPct[intval($r['idLikelihood'])]) ? $likelihoodPct[intval($r['idLikelihood'])] : 0;
  if (!isset($estimateTotal[$key])) { $estimateTotal[$key]=0; $estimatePossible[$key]=0; }
  $estimateTotal[$key]+=$amount;
  $estimatePossible[$key]+=$amount*$pct/100;
}

// ---- rows to display : active engagements, plus any idle one or "undefined"
//      that still carries a count on one of the displayed snapshots ---------
$rows=array();
foreach ($engagements as $id=>$eng) {
  if (!$eng['idle'] or isset($counts[$id])) {
    $rows[$id]=htmlEncode($eng['name']);
  }
}
if (isset($counts[0])) {
  $rows[0]='<i>' . i18n('undefinedValue') . '</i>';
}

// ---- render the table (last 3 months only) ----------------------------
$tableMonths=array_slice($months, -$nbTableMonths, $nbTableMonths, true);

echo '<table width="90%" align="center">';
echo '<tr>';
echo '<td class="reportTableHeader" style="width:25%" rowspan="2">' . i18n('Engagement') . '</td>';
echo '<td class="reportTableHeader" style="width:25%" colspan="3">' . i18n('menuProspect') . '</td>';
echo '<td class="reportTableHeader" style="width:25%" colspan="2">' . i18n('menuProspectEstimate') . '</td>';
echo '</tr>';
echo '<tr>';
foreach ($tableMonths as $month) {
  echo '<td class="reportTableColumnHeader" style="width:13%;text-align:center;">' . htmlEncode($month['label']) . '</td>';
}
echo '<td class="reportTableColumnHeader" style="width:18%;text-align:center;">' . i18n('sum') . '</td>';
echo '<td class="reportTableColumnHeader" style="width:18%;text-align:center;">' . ucfirst(i18n('colEstimated')) . '</td>';
echo '</tr>';

$totals=array_fill(0, $nbMonths, 0);
$totalEstimateTotal=0;
$totalEstimatePossible=0;
foreach ($rows as $id=>$label) {
  echo '<tr>';
  echo '<td class="reportTableLineHeader">' . $label . '</td>';
  foreach ($tableMonths as $mIndex=>$month) {
    $val=isset($counts[$id][$mIndex]) ? $counts[$id][$mIndex] : 0;
    $totals[$mIndex]+=$val;
    echo '<td class="reportTableData" style="text-align:center;">' . $val . '</td>';
  }
  $rowEstimateTotal=isset($estimateTotal[$id]) ? $estimateTotal[$id] : 0;
  $rowEstimatePossible=isset($estimatePossible[$id]) ? $estimatePossible[$id] : 0;
  $totalEstimateTotal+=$rowEstimateTotal;
  $totalEstimatePossible+=$rowEstimatePossible;
  echo '<td class="reportTableData" style="text-align:center;">' . htmlDisplayCurrency($rowEstimateTotal) . '</td>';
  echo '<td class="reportTableData" style="text-align:center;">' . htmlDisplayCurrency($rowEstimatePossible) . '</td>';
  echo '</tr>';
}

echo '<tr>';
echo '<td class="reportTableHeader">' . i18n('sum') . '</td>';
foreach ($tableMonths as $mIndex=>$month) {
  echo '<td class="reportTableHeader" style="text-align:center;">' . $totals[$mIndex] . '</td>';
}
echo '<td class="reportTableHeader" style="text-align:center;">' . htmlDisplayCurrency($totalEstimateTotal) . '</td>';
echo '<td class="reportTableHeader" style="text-align:center;">' . htmlDisplayCurrency($totalEstimatePossible) . '</td>';
echo '</tr>';

echo '<tr>';
echo '<td class="reportTableLineHeader">' . i18n('reportConvertedProspects') . '</td>';
foreach ($tableMonths as $mIndex=>$month) {
  echo '<td class="reportTableData" style="text-align:center;">' . $convertedCounts[$mIndex] . '</td>';
}
echo '<td class="reportTableData">&nbsp;</td><td class="reportTableData">&nbsp;</td>';
echo '</tr>';

echo '<tr>';
echo '<td class="reportTableLineHeader">' . i18n('menuQuotation') . '</td>';
foreach ($tableMonths as $mIndex=>$month) {
  echo '<td class="reportTableData" style="text-align:center;">' . htmlDisplayCurrency($quotedAmounts[$mIndex]) . '</td>';
}
echo '<td class="reportTableData">&nbsp;</td><td class="reportTableData">&nbsp;</td>';
echo '</tr>';

echo '<tr>';
echo '<td class="reportTableLineHeader">' . i18n('menuCommand') . '</td>';
foreach ($tableMonths as $mIndex=>$month) {
  echo '<td class="reportTableData" style="text-align:center;">' . htmlDisplayCurrency($orderedAmounts[$mIndex]) . '</td>';
}
echo '<td class="reportTableData">&nbsp;</td><td class="reportTableData">&nbsp;</td>';
echo '</tr>';
echo '</table>';
echo '<br/>';

// ---- 12 month trend curve for the two hottest engagements ------------------
$idHot1=null; $idHot2=null;
foreach ($engagements as $id=>$eng) {
  if (pq_strtolower($eng['name'])=='bouillant') $idHot1=$id;
  if (pq_strtolower($eng['name'])=='chaud') $idHot2=$id;
}
if ($idHot1===null or $idHot2===null) {
  // Names not found (renamed/localized list) : fall back to the two engagements
  // with the lowest sortOrder, which is this scale's usual "hottest" end.
  $ids=array_keys($engagements);
  if ($idHot1===null) $idHot1=isset($ids[0]) ? $ids[0] : null;
  if ($idHot2===null) $idHot2=isset($ids[1]) ? $ids[1] : null;
}

if ($idHot1!==null and $idHot2!==null and testGraphEnabled()) {
  $serie1=isset($counts[$idHot1]) ? $counts[$idHot1] : array_fill(0, $nbMonths, 0);
  $serie2=isset($counts[$idHot2]) ? $counts[$idHot2] : array_fill(0, $nbMonths, 0);
  $labels=array();
  foreach ($months as $mIndex=>$month) { $labels[$mIndex]=$month['shortLabel']; }

  $dataSet=new pData();
  $dataSet->addPoints($serie1, "hot1");
  $dataSet->setSerieDescription("hot1", $engagements[$idHot1]['name']);
  $dataSet->setSerieOnAxis("hot1", 0);
  $dataSet->addPoints($serie2, "hot2");
  $dataSet->setSerieDescription("hot2", $engagements[$idHot2]['name']);
  $dataSet->setSerieOnAxis("hot2", 0);
  $dataSet->addPoints($convertedCounts, "converted");
  $dataSet->setSerieDescription("converted", i18n('reportConvertedProspects'));
  $dataSet->setSerieOnAxis("converted", 0);
  $dataSet->addPoints($labels, "months");
  $dataSet->setAbscissa("months");

  $color1=$engagements[$idHot1]['color'] ? hex2rgb($engagements[$idHot1]['color']) : array('R'=>200, 'G'=>50, 'B'=>50);
  $color2=$engagements[$idHot2]['color'] ? hex2rgb($engagements[$idHot2]['color']) : array('R'=>230, 'G'=>140, 'B'=>40);
  $dataSet->setPalette("hot1", array_merge($color1, array('Alpha'=>100)));
  $dataSet->setPalette("hot2", array_merge($color2, array('Alpha'=>100)));
  $dataSet->setPalette("converted", array('R'=>70, 'G'=>160, 'B'=>90, 'Alpha'=>100));
  $dataSet->setSerieDrawable("hot1", true);
  $dataSet->setSerieDrawable("hot2", true);
  $dataSet->setSerieDrawable("converted", true);

  $width=1000;
  $height=400;
  $graph=new pImage($width, $height, $dataSet);
  $graph->Antialias=TRUE;
  $graph->setFontProperties(array("FontName"=>getFontLocation("verdana"), "FontSize"=>8, "R"=>100, "G"=>100, "B"=>100));
  $graph->setGraphArea(50, 30, $width-140, $height-80);

  $formatGrid=array("Mode"=>SCALE_MODE_START0, "GridTicks"=>0,
      "DrawYLines"=>array(0), "DrawXLines"=>false,
      "LabelRotation"=>60, "GridR"=>200, "GridG"=>200, "GridB"=>200);
  $graph->drawScale($formatGrid);

  $graph->drawLineChart();
  $graph->drawPlotChart();

  $graph->drawLegend($width-120, 17, array("Mode"=>LEGEND_VERTICAL, "Family"=>LEGEND_FAMILY_BOX,
      "R"=>255, "G"=>255, "B"=>255, "Alpha"=>100,
      "FontR"=>55, "FontG"=>55, "FontB"=>55,
      "Margin"=>5));

  $imgName=getGraphImgName("prospectByEngagement");
  $graph->Render($imgName);
  echo '<table width="95%" align="center"><tr><td align="center">';
  echo '<img src="' . $imgName . '" />';
  echo '</td></tr></table>';
}

end:
