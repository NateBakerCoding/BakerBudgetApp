import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AllInfoComponent } from './all-info.component';

describe('AllInfoComponent', () => {
  let component: AllInfoComponent;
  let fixture: ComponentFixture<AllInfoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AllInfoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AllInfoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
