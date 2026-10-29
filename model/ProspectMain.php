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
//test
/** ============================================================================
 * Action is establised during meeting, to define an action to be followed.
 */ 
require_once('_securityCheck.php'); 
class ProspectMain extends SqlElement {
  
  public $_sec_description;
  public $id;
  public $name;
  public $idUser;
  public $creationDateTime;
  public $prospectNameContact;
  public $prospectNameCompany;
  public $idProspectType;
  public $idProspectionSource;
  public $idProspectQualification;
  public $idProspectOrigin;
  public $idDomainProspect;
  public $idLanguage;
  public $idEngagement;
  public $prospectFunction;
  public $idPositionProspect;
  public $idDecisionMakerProspect;
  public $description; 
  public $_sec_Contact;
  public $email;
  public $phone;
  public $mobile;
  public $fax;
  public $networkLink; 
  public $_sec_Address;
  public $designation;
  public $street;
  public $complement;
  public $zip;
  public $city;
  public $state;
  public $country;
  public $_sec_treatment;
  public $idStatus;
  public $idResource;
  public $idle;
  public $_multiple_ProspectEvent;
  public $_spe_buttonTransform;
  public $lastEventDatetime;
  public $toBeRecontacted;
  public $_sec_eventProspect;
  public $_spe_ProspectEvent;
  public $_sec_ProspectEstimateList;
  public $_spe_ProspectEstimate;
  public $_sec_Link_Prospect;
  public $_Link_Prospect=array();
  //public $_sec_Link_Client;
  //public $_Link_Client=array();
  //public $_sec_Link_Contact;
  //public $_Link_Contact=array();
  public $_sec_Link;
  public $_Link=array();
  public $_Attachment=array();
  public $_Note=array();
  public $_nbColMax=3;

  private static $_fieldsAttributes=array(
    "id"=>"",
    "idProspectType"=>"required",
    "idProspectionSource"=>"required",
    "lastEventDatetime"=>"readonly",
    "idle"=>"",
    "name"=>"hidden",
    "idStatus"=>"required",
    "prospectNameContact"=>"",
    "_multiple_ProspectEvent"=>"hidden",
  );
  
  private static $_layout='
    <th field="id" formatter="numericFormatter" width="5%"># ${id}</th>
    <th field="name" width="30%" >${name}</th>
    <th field="nameProspectionSource" width="10%">${idProspectionSource}</th>
    <th field="nameProspectOrigin" width="15%">${idProspectOrigin}</th>
    <th field="nameDecisionMakerProspect" width="10%">${idDecisionMakerProspect}</th>
    <th field="colorNameStatus" formatter="colorNameFormatter" width="10%">${idStatus}</th>
    <th field="lastEventDatetime" formatter="dateFormatter" width="10%">${lastEventDatetime}</th>
    <th field="toBeRecontacted" formatter="dateFormatter" width="10%">${toBeRecontacted}</th>
    ';
  
  private static $_colCaptionTransposition = array('idResource'=> 'responsible');
  
  private static $_databaseColumnName = array();
 
  /** ==========================================================================
	 * Constructor
	 * @param $id Int the id of the object in the database (null if not stored yet)
	 * @return void
	 */
	function __construct($id = NULL, $withoutDependentObjects=false) {
		parent::__construct($id,$withoutDependentObjects);
	}
	
	/** ==========================================================================
	 * Destructor
	 * @return void
	 */
	function __destruct() {
		parent::__destruct();
	}

	/** ==========================================================================
	 * Return the specific layout
	 * @return String the layout
	 */
	
	protected function getStaticLayout() {
	  return self::$_layout;
	}
	
  /** ==========================================================================
   * Return the specific fieldsAttributes
   * @return Array the fieldsAttributes  
   */
  protected function getStaticFieldsAttributes() {
    return array_merge(parent::getStaticFieldsAttributes(),self::$_fieldsAttributes);
  }
  
  /** ============================================================================
   * Return the specific colCaptionTransposition
   * @return String the colCaptionTransposition
   */
  protected function getStaticColCaptionTransposition($fld=null) {
    return self::$_colCaptionTransposition;
  }
  
  /** ========================================================================
   * Return the specific databaseTableName
   * @return String the databaseTableName
   */
  protected function getStaticDatabaseColumnName() {
    return self::$_databaseColumnName;
  }
 
  /** ============================================================================
   * Set attribut from parent : merge current attributes with those of Main class
   * @return void
   */
  public function setAttributes() {
    if (!$this->id) {
      self::$_fieldsAttributes['_sec_ProspectEstimateList']='hidden';
      self::$_fieldsAttributes['_spe_ProspectEstimate']='hidden';
    }
	} 
  
// ============================================================================**********
// GET VALIDATION SCRIPT
// ============================================================================**********

/** ==========================================================================
 * Return the validation sript for some fields
 * @return String the validation javascript (for dojo framework)
 */
public function getValidationScript($colName, $date=null) {
  $colScript = parent::getValidationScript($colName);

    if ($colName=="idProspectionSource") {
        $colScript .= '<script type="dojo/connect" event="onChange" >';
        $colScript .= '  refreshList("idProspectOrigin", "idProspectionSource", this.value, null, null, false);';
        $colScript .= '  formChanged();';
        $colScript .= '</script>';
    } 
    return $colScript;
    
} 
  public function save() {
      $this->name=$this->prospectNameCompany.(($this->prospectNameCompany and $this->prospectNameContact)?' | ':'').$this->prospectNameContact; 
      // The record form fills the creation date ; other creation paths may not.
      if (!$this->id and !$this->creationDateTime) {
        $this->creationDateTime=date('Y-m-d H:i:s');
      }
      $result = parent::save();
      return $result;
	} 

  /**
   * Converts the prospect into a client : a new client when it names a company,
   * then this prospect and the other open prospects of the same company attached to
   * it. No transaction here, the caller owns it. Returns the prospect save result.
   */
  public function transformToClient() {
    $client=null;
    if ($this->prospectNameCompany != null) {
      $client=new Client();
      $client->name=$this->prospectNameCompany;
      $type=new ClientType();
      // The class adds its own scope='Client' criterion with AND, which binds tighter
      // than OR : without these brackets the query returns any scope, and the sort on
      // sortOrder puts the ProspectType first.
      $typeList=$type->getSqlElementsFromCriteria(null,null,"(name like '%Prospect%' or name like '%".i18n('Prospect')."%')");
      if (count($typeList)>0) {
        $typeOjb=reset($typeList);
        $typeCli=$typeOjb->id;
      } else {
        $typeList=$type->getSqlElementsFromCriteria(null,null,"idle=0");
        $typeOjb=reset($typeList);
        $typeCli=$typeOjb->id;
      }
      $client->idClientType=$typeCli;
      $client->designation=$this->designation??null;
      $client->street=$this->street??null;
      $client->complement=$this->complement??null;
      $client->zip=$this->zip??null;
      $client->city=$this->city??null;
      $client->state=$this->state??null;
      $client->country=$this->country??null;
      $client->fillRequiredFields();
      $resCli=$client->save();
      if (getLastOperationStatus($resCli)!='OK') {
        traceLog($resCli);
        $client=null;
      }
    }
    if ($client) {
      $this->attachToClient($client);
      foreach ($this->getSameCompanyProspects() as $other) {
        $resOther=$other->attachToClient($client);
        if (getLastOperationStatus($resOther)!='OK') traceLog($resOther);
      }
    } else if ($this->prospectNameContact != null) {
      $this->createContact(null);
    }
    $this->lastEventDatetime=date('Y-m-d H:i:s');
    return $this->save();
  }

  /**
   * Attaches the prospect to a client : a link, and a contact of the client linked
   * to the prospect when the prospect names a contact. Returns the last save result.
   */
  public function attachToClient($client) {
    $lnk=new Link();
    $lnk->ref1Type='Client';
    $lnk->ref1Id=$client->id;
    $lnk->ref2Type='Prospect';
    $lnk->ref2Id=$this->id;
    $result=$lnk->save();
    if (getLastOperationStatus($result)!='OK') traceLog($result);
    if ($this->prospectNameContact != null) {
      $result=$this->createContact($client);
    }
    return $result;
  }

  /**
   * Creates a contact from the prospect, of the client when one is given, and links
   * it to the prospect. Returns the contact save result.
   */
  private function createContact($client) {
    $contact=new Contact();
    $contact->name=$this->prospectNameContact;
    $contact->email=$this->email??null;
    $contact->contactFunction=$this->prospectFunction??null;
    $contact->phone=$this->phone??null;
    $contact->mobile=$this->mobile??null;
    $contact->fax=$this->fax??null;
    if ($client and $client->id) $contact->idClient=$client->id;
    $contact->designation=$this->designation??null;
    $contact->street=$this->street??null;
    $contact->complement=$this->complement??null;
    $contact->zip=$this->zip??null;
    $contact->city=$this->city??null;
    $contact->state=$this->state??null;
    $contact->country=$this->country??null;
    $contact->fillRequiredFields();
    $result=$contact->save();
    if (getLastOperationStatus($result)!='OK') {
      traceLog($result);
      return $result;
    }
    $lnk=new Link();
    $lnk->ref1Type='Contact';
    $lnk->ref1Id=$contact->id;
    $lnk->ref2Type='Prospect';
    $lnk->ref2Id=$this->id;
    $lnk->save();
    return $result;
  }

  /**
   * The other open prospects of the same company, linked to no client yet.
   */
  public function getSameCompanyProspects() {
    $name=self::normalizeCompanyName($this->prospectNameCompany);
    if ($name==='') return array();
    $link=new Link();
    $linkTable=$link->getDatabaseTableName();
    $table=$this->getDatabaseTableName();
    // The names are compared in PHP : SQL can neither fold inner spaces portably
    // nor keep accents apart under a general_ci collation.
    $clause="(idle=0 and id<>".intval($this->id)." and prospectNameCompany is not null"
           ." and not exists (select 1 from $linkTable l where"
           ." (l.ref1Type='Client' and l.ref2Type='Prospect' and l.ref2Id=$table.id)"
           ." or (l.ref2Type='Client' and l.ref1Type='Prospect' and l.ref1Id=$table.id)))";
    $same=array();
    foreach ($this->getSqlElementsFromCriteria(null, false, $clause) as $other) {
      if (self::normalizeCompanyName($other->prospectNameCompany)===$name) $same[]=$other;
    }
    return $same;
  }

  /**
   * Company name as compared between prospects : trimmed, inner spaces folded,
   * lower case, accents kept.
   */
  public static function normalizeCompanyName($name) {
    return mb_strtolower(preg_replace('/\s+/u', ' ', pq_trim((string)$name)), 'UTF-8');
  }

  /**
   * Closes the open prospects linked to a contact of the client, on the first
   * command of that client. The status is kept. Returns how many were closed.
   */
  public static function closeClientProspects($idClient) {
    $idClient=intval($idClient);
    if (!$idClient) return 0;
    $prospect=new Prospect();
    $link=new Link();
    $contact=new Contact();
    $table=$prospect->getDatabaseTableName();
    $linkTable=$link->getDatabaseTableName();
    $contactTable=$contact->getDatabaseTableName();
    $clause="(idle=0 and $table.id in (select case when l.ref1Type='Prospect' then l.ref1Id else l.ref2Id end"
           ." from $linkTable l, $contactTable r where r.isContact=1 and r.idClient=$idClient"
           ." and ((l.ref1Type='Contact' and l.ref1Id=r.id and l.ref2Type='Prospect')"
           ." or (l.ref2Type='Contact' and l.ref2Id=r.id and l.ref1Type='Prospect'))))";
    $closed=0;
    foreach ($prospect->getSqlElementsFromCriteria(null, false, $clause) as $open) {
      // The note says why the prospect is closed. A failure is traced, the prospect
      // is closed anyway.
      $note=new Note();
      $note->refType='Prospect';
      $note->refId=$open->id;
      $note->note=i18n('noteProspectClosedAfterOrder');
      $note->idUser=getSessionUser()->id;
      $note->creationDate=date('Y-m-d H:i:s');
      $resNote=$note->save();
      if (getLastOperationStatus($resNote)!='OK') {
        errorLog("Prospect #".$open->id." : note not written before closing : ".$resNote);
      }
      $open->idle=1;
      $result=$open->save();
      if (getLastOperationStatus($result)=='OK') {
        $closed++;
      } else {
        errorLog("Prospect #".$open->id." : not closed on the first command of client #".$idClient." : ".$result);
      }
    }
    return $closed;
  }
  /**
   * SQL clause restricting prospects to a creation period, both bounds included.
   * A start without end covers one month ; a bound that is not a valid Y-m-d date
   * is ignored. Returns an empty string when no bound applies.
   */
  public static function getCreationPeriodClause($start, $end) {
    $obj=new Prospect();
    $col=$obj->getDatabaseTableName().'.'.$obj->getDatabaseColumnName('creationDateTime');
    $start=self::getValidPeriodDate($start);
    $end=self::getValidPeriodDate($end);
    if ($start and !$end) $end=self::getDefaultPeriodEnd($start);
    $clause=array();
    if ($start) $clause[]=$col.'>='.Sql::str($start.' 00:00:00');
    if ($end) $clause[]=$col.'<'.Sql::str(date('Y-m-d', strtotime($end.' +1 day')).' 00:00:00');
    return (count($clause))?'('.implode(' and ', $clause).')':'';
  }

  /**
   * End of a period given only its start : one calendar month later, same day of
   * month, or the last day of that month when it is shorter. Empty when the start
   * is not a valid date.
   */
  public static function getDefaultPeriodEnd($start) {
    $start=self::getValidPeriodDate($start);
    if (!$start) return '';
    $year=intval(substr($start, 0, 4));
    $month=intval(substr($start, 5, 2))+1;
    if ($month>12) { $month=1; $year++; }
    $day=min(intval(substr($start, 8, 2)), intval(date('t', mktime(0, 0, 0, $month, 1, $year))));
    return sprintf('%04d-%02d-%02d', $year, $month, $day);
  }

  /**
   * Returns the date when it is a valid Y-m-d date, an empty string otherwise.
   */
  public static function getValidPeriodDate($date) {
    $date=pq_trim((string)$date);
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m)) return '';
    return (checkdate(intval($m[2]), intval($m[3]), intval($m[1])))?$date:'';
  }
  
	public function control(){
	  $result="";
	
	  if (pq_trim($this->prospectNameContact)=='' and pq_trim($this->prospectNameCompany)=='') {
	    $result.='<br/>' . i18n('messageMandatory',array(i18n('colProspectNameContact') . ' ' .i18n('OR'). ' '.i18n('colProspectNameCompany')));
	  }
	  
	
	  $defaultControl=parent::control();
	  if ($defaultControl!='OK') {
	    $result.=$defaultControl;
	  }if ($result=="") {
	    $result='OK';
	  }
	  return $result;
	}
	
  public function drawSpecificItem($item){
    global $print;
    
    $result="";
    if ($item=='ProspectEstimate') {
      $result .= drawProspectEstimateList($this);
      return $result;
    }
    if ($item=='buttonTransform' and $this->id) {
      $lnk=new Link();
      $cpt=$lnk->countSqlElementsFromCriteria(null,"ref2Type='Prospect' and ref2Id=$this->id and (ref1Type='Contact' or ref1Type='Client')");
      if ($cpt==0) {
        $result .= '<tr><td valign="top" class="label"><label></label></td><td>';
        $result .= '<button style="height:71% !important;" class="dynamicTextButton" id="prospectTransform" dojoType="dijit.form.Button" showlabel="true" onClick ="saveProspectTransform('.$this->id.')"';
        $result .= ' title="' . i18n('buttonTransformTitle') . '" >';
        $result .= '<span>' . i18n('buttonTransform') . '</span>';
        $result .= '</button>';
        $result .= '</td></tr>';
      }
    } else if ($item=='ProspectEvent') {
      // No contact column on a prospect : its actions never carry one.
      ProspectEvent::drawList($this, array('refType'=>'Prospect', 'refId'=>($this->id??'0')), false);
    }
    return $result;
  }
  
  

	
}
?>