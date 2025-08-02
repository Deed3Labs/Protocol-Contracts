# Vehicle Assets - Validation Requirements

Vehicle assets represent automotive and transportation equipment that can be tokenized as DeedNFTs. This document outlines the comprehensive validation requirements for vehicle assets, including technical specifications and user experience guidelines.

## 🚗 Asset Overview

Vehicle assets include:
- **Automobiles**: Cars, trucks, SUVs, and passenger vehicles
- **Motorcycles**: Motorcycles, scooters, and motorized bikes
- **Boats**: Recreational boats, yachts, and watercraft
- **Aircraft**: Private planes, helicopters, and aircraft
- **Commercial Vehicles**: Trucks, buses, and commercial transport
- **Recreational Vehicles**: RVs, campers, and mobile homes

## 📋 Required Metadata Traits

### Core Vehicle Information

| Trait | Type | Description | Example |
|-------|------|-------------|---------|
| `make` | string | Vehicle manufacturer | "Tesla", "Ford", "Honda" |
| `model` | string | Vehicle model | "Model 3", "F-150", "Civic" |
| `year` | number | Manufacturing year | 2020 |
| `vin` | string | Vehicle Identification Number | "1HGBH41JXMN109186" |
| `condition` | string | Current condition assessment | "Excellent", "Good", "Fair" |
| `mileage` | number | Current mileage/usage hours | 50000 |
| `mileage_unit` | string | Unit of measurement | "miles", "kilometers", "hours" |

### Legal Information

| Trait | Type | Description | Example |
|-------|------|-------------|---------|
| `registration_number` | string | Vehicle registration number | "ABC123" |
| `registration_date` | string | Registration date | "2024-01-15" |
| `jurisdiction` | string | Legal jurisdiction | "California" |
| `title_number` | string | Vehicle title number | "T-12345-2024" |
| `lien_holder` | string | Lien holder (if applicable) | "Bank of America" |

### Technical Specifications

| Trait | Type | Description | Example |
|-------|------|-------------|---------|
| `engine_type` | string | Engine type | "Electric", "Gasoline", "Diesel" |
| `transmission` | string | Transmission type | "Automatic", "Manual", "CVT" |
| `fuel_type` | string | Fuel type | "Electric", "Gasoline", "Hybrid" |
| `color` | string | Vehicle color | "Red", "Blue", "White" |
| `body_style` | string | Body style | "Sedan", "SUV", "Truck" |

## 📄 Required Documents

### Primary Documents

1. **Vehicle Registration**
   - Current vehicle registration certificate
   - Must be valid and not expired
   - Should show clear ownership
   - No liens or encumbrances (or disclosed)

2. **Vehicle Title**
   - Original or certified copy of vehicle title
   - Must be current and valid
   - Should show clear ownership chain
   - No undisclosed liens

3. **VIN Verification**
   - VIN verification report
   - National Motor Vehicle Title Information System (NMVTIS) report
   - Odometer reading verification
   - Theft check verification

### Secondary Documents

4. **Condition Assessment**
   - Professional vehicle inspection report
   - Mechanical condition assessment
   - Safety inspection certificate
   - Emissions test results (if applicable)

5. **Insurance Information**
   - Current insurance policy
   - Coverage details and limits
   - Claims history (if any)
   - Insurance valuation

6. **Maintenance Records**
   - Service and maintenance history
   - Repair records and receipts
   - Warranty information
   - Recall notices and compliance

## 🔍 Validation Process

### Step 1: Document Review

**Validator Actions:**
- Verify vehicle registration authenticity
- Check VIN against national databases
- Review title for liens and encumbrances
- Assess condition reports
- Verify insurance coverage

**Required Checks:**
- [ ] Registration is valid and current
- [ ] VIN matches registration and title
- [ ] No undisclosed liens or encumbrances
- [ ] Condition assessment is professional and accurate
- [ ] Insurance coverage is adequate

### Step 2: Physical Verification

**On-Site Inspection:**
- Verify vehicle identity and condition
- Check VIN plate and engine numbers
- Assess mechanical condition
- Document current mileage
- Photograph key features

**Required Documentation:**
- [ ] VIN verification photos
- [ ] Current condition photos
- [ ] Mileage verification
- [ ] Mechanical assessment
- [ ] Safety inspection results

### Step 3: Legal Compliance

**Legal Verification:**
- Confirm ownership transferability
- Verify regulatory compliance
- Check for legal restrictions
- Assess marketability

**Required Checks:**
- [ ] Vehicle is legally transferable
- [ ] Complies with local regulations
- [ ] No legal restrictions prevent tokenization
- [ ] Marketable title confirmed

## 🎯 User Experience Guidelines

### For Vehicle Owners

#### Before Minting

1. **Gather Documents**
   - Collect all required documents
   - Ensure documents are current and valid
   - Make digital copies for upload
   - Organize documents by category

2. **Prepare Information**
   - Verify VIN accuracy
   - Check registration status
   - Assess vehicle condition
   - Research market value

3. **Professional Services**
   - Consider professional inspection
   - Get VIN verification report
   - Obtain condition assessment
   - Check insurance coverage

#### During Minting Process

1. **Asset Type Selection**
   - Select "Vehicle" as asset type
   - Choose appropriate vehicle subcategory
   - Provide accurate vehicle description

2. **Metadata Entry**
   - Enter all required traits accurately
   - Use precise VIN and registration information
   - Include complete technical specifications
   - Provide detailed condition information

3. **Document Upload**
   - Upload high-quality document scans
   - Ensure documents are legible
   - Include all required documents
   - Add explanatory notes if needed

#### After Minting

1. **Track Validation**
   - Monitor validation progress
   - Respond to validator requests promptly
   - Provide additional information if requested
   - Address any validation issues

2. **Manage Asset**
   - Keep documents updated
   - Monitor vehicle condition
   - Update information as needed
   - Maintain compliance with regulations

### For Validators

#### Validation Checklist

**Document Verification:**
- [ ] Vehicle registration authenticity confirmed
- [ ] VIN verification completed
- [ ] Title examination verified
- [ ] Condition assessment reviewed
- [ ] Insurance coverage verified

**Physical Verification:**
- [ ] Vehicle identity verified
- [ ] Current condition assessed
- [ ] Mileage verified
- [ ] Mechanical condition documented
- [ ] Safety inspection completed

**Legal Compliance:**
- [ ] Ownership transferability confirmed
- [ ] Regulatory compliance verified
- [ ] Legal restrictions assessed
- [ ] Marketable title confirmed

#### Validation Notes

**Required Information:**
- Validation decision and reasoning
- Any issues or concerns identified
- Recommendations for improvement
- Compliance with validation criteria
- Additional requirements if any

## ⚠️ Common Issues and Solutions

### Document Issues

**Problem**: Missing or outdated registration
**Solution**: Request current registration from owner

**Problem**: VIN mismatch
**Solution**: Require VIN verification and correction

**Problem**: Unclear ownership
**Solution**: Require title examination and lien search

### Legal Issues

**Problem**: Undisclosed liens
**Solution**: Require lien search and disclosure

**Problem**: Registration issues
**Solution**: Verify registration status and compliance

**Problem**: Insurance lapses
**Solution**: Require current insurance verification

### Technical Issues

**Problem**: Inaccurate mileage
**Solution**: Require odometer verification

**Problem**: Incomplete specifications
**Solution**: Request additional technical information

**Problem**: Poor condition documentation
**Solution**: Require professional condition assessment

## 📊 Validation Criteria

### Minimum Requirements

**For Basic Validation:**
- Valid vehicle registration
- Clear vehicle title
- VIN verification
- No undisclosed liens
- Legal transferability

**For Enhanced Validation:**
- Professional condition assessment
- Insurance verification
- Maintenance history
- Market analysis
- Legal opinion

### Quality Standards

**Document Quality:**
- High-resolution scans
- Complete and legible
- Current and valid
- Professional preparation

**Information Accuracy:**
- Precise VIN and registration
- Accurate specifications
- Complete metadata
- Verified facts

**Legal Compliance:**
- Regulatory compliance
- Legal transferability
- Clear ownership
- No restrictions

## 🔄 Post-Validation Management

### Ongoing Requirements

1. **Document Updates**
   - Keep registration current
   - Update insurance information
   - Maintain maintenance records
   - Track vehicle changes

2. **Condition Monitoring**
   - Regular vehicle inspections
   - Document maintenance and repairs
   - Monitor mileage changes
   - Track market conditions

3. **Compliance Maintenance**
   - Stay current with regulations
   - Maintain required permits
   - Address any violations
   - Update registration compliance

### Transfer Requirements

When transferring vehicle assets:

1. **Document Transfer**
   - Transfer all relevant documents
   - Update ownership records
   - Provide transfer history
   - Maintain validation status

2. **Validation Continuity**
   - Preserve validation records
   - Transfer validation certificates
   - Update validator information
   - Maintain compliance status

## 🚀 Best Practices

### For Vehicle Owners

1. **Preparation**
   - Gather all documents early
   - Ensure accuracy of information
   - Address any issues proactively
   - Seek professional advice when needed

2. **Documentation**
   - Keep detailed records
   - Maintain document organization
   - Update information regularly
   - Backup important documents

3. **Compliance**
   - Stay current with regulations
   - Monitor vehicle condition
   - Address issues promptly
   - Maintain good standing

### For Validators

1. **Thorough Review**
   - Examine all documents carefully
   - Verify information accuracy
   - Check for completeness
   - Identify potential issues

2. **Professional Standards**
   - Maintain objectivity
   - Follow established criteria
   - Document decisions clearly
   - Provide constructive feedback

3. **Continuous Improvement**
   - Stay updated on regulations
   - Learn from validation experiences
   - Improve validation processes
   - Share best practices

## 🚗 Vehicle-Specific Considerations

### Different Vehicle Types

**Automobiles**
- Standard VIN verification
- Registration and title requirements
- Condition assessment
- Insurance verification

**Motorcycles**
- VIN verification (may be shorter)
- Registration requirements
- Safety inspection
- Insurance coverage

**Boats**
- Hull identification number (HIN)
- Coast Guard documentation
- Marine survey
- Insurance requirements

**Aircraft**
- Aircraft registration number
- FAA documentation
- Airworthiness certificate
- Insurance coverage

**Commercial Vehicles**
- Commercial registration
- DOT compliance
- Safety inspections
- Commercial insurance

### Special Considerations

**Classic Vehicles**
- Historical documentation
- Appraisal requirements
- Special insurance
- Restoration history

**Electric Vehicles**
- Battery condition assessment
- Charging infrastructure
- Warranty information
- Range verification

**Modified Vehicles**
- Modification documentation
- Safety compliance
- Insurance implications
- Legal requirements

---

*This documentation is part of The Deed Protocol v0.2.0-beta. For questions about vehicle asset validation, please contact the development team.* 